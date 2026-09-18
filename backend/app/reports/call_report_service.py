"""
Call Report Service — generates the structured lead report at call end (spec §32).

Spec §30 §31 §32 §66:
  At call end we produce a CallReport with:
    - caller_name, student_name, student_class, course, location, budget,
      hostel, transport  (extracted from memory + transcript)
    - interest_score (0-100), conversion_probability (0-100)
    - intent: HOT / WARM / COLD
    - lead_status: HOT LEAD / WARM LEAD / COLD LEAD / NEW
    - objections, next_action
    - summary (2-3 sentence narrative), questions_asked
  The caller's phone is the authoritative lead identifier; the caller_name
  extracted from the conversation is displayed in the UI.

No fake percentages.  Interest score is labelled as AI-estimated where exposed.
"""

from __future__ import annotations

import asyncio
import re
from typing import Optional
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.models import CallHistory, CallReport, Sentiment
from app.logs.logger import get_logger
from app.roman_telugu import transliterate_roman_telugu

logger = get_logger(__name__)


# ── Lightweight lead extraction (no external LLM required at call end) ──────
# This runs inline at call end so a report is always produced even when the
# LLM service is unavailable.  It is deliberately simple and conservative:
# it only extracts what it can confidently find in the transcript + memory.

_LEAD_INTENT_WORDS = {
    "hot": [
        "visit", "callback", "come", "arrange", "schedule", "book", "sit",
        "meet", "tour", "campus visit", "arrange a visit", "arrange callback",
        "send information", "send me the details", "send brochure",
        "already decided", "taking admission", "admission this year",
        "start this academic year", "this year", "admission",
    ],
    "warm": [
        "maybe", "think about", "consider", "let me think", "check with",
        "ask my spouse", "ask my parents", "discuss with", "need to think",
        "will decide", "not sure yet", "still exploring", "one more question",
        "clarify", "tell me more", "more details", "fees",
    ],
    "cold": [
        "not interested", "no thanks", "not now", "not at the moment",
        "wrong number", "not looking", "just exploring", "no", "don't want",
        "not interested in", "no admission", "not considering",
    ],
}


def _lead_intent_from_transcript(transcript: str) -> str:
    """Return HOT / WARM / COLD based on the whole transcript."""
    if not transcript:
        return "COLD"
    t = transcript.lower()
    hot_hits = sum(1 for w in _LEAD_INTENT_WORDS["hot"] if w in t)
    warm_hits = sum(1 for w in _LEAD_INTENT_WORDS["warm"] if w in t)
    cold_hits = sum(1 for w in _LEAD_INTENT_WORDS["cold"] if w in t)
    if cold_hits >= 2 or (cold_hits >= 1 and hot_hits == 0 and warm_hits == 0):
        return "COLD"
    if hot_hits >= 1:
        return "HOT"
    if warm_hits >= 1 or cold_hits == 1:
        return "WARM"
    return "WARM"  # default: mid interest unless clearly cold


def _questions_from_transcript(transcript: str) -> list[str]:
    """Extract distinct questions asked by the CALLER (heuristic).

    The transcript is line-formatted as ``[user] ...`` / ``[assistant] ...``;
    only caller lines count as questions (the agent's own prompts are not
    caller questions), and role tags are stripped so summaries stay clean.
    """
    if not transcript:
        return []
    caller_lines: list[str] = []
    for line in transcript.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.lower().startswith("[user]"):
            caller_lines.append(stripped[6:].strip())
        elif not stripped.startswith("["):
            # Unstructured transcript: keep the line as-is.
            caller_lines.append(stripped)
    # A question mark usually = a caller question in an admissions call.
    questions: list[str] = []
    for line in caller_lines:
        for q in line.split("?"):
            q = q.strip()
            if q:
                questions.append(q + "?")
    # Deduplicate by lower-case normalized form.
    seen: set[str] = set()
    out: list[str] = []
    for q in questions:
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
        if len(out) >= 12:
            break
    return out


def _extract_lead_fields(
    transcript: str,
    memory: dict,
    institute_name: str,
) -> dict:
    """Pull lead fields from memory (authoritative) with transcript fallback."""
    fields: dict = {
        "caller_name": memory.get("Name") or "",
        "student_name": memory.get("Student Name") or "",
        "student_class": memory.get("Class") or "",
        "course": memory.get("Course") or "",
        "location": memory.get("Location") or "",
        "budget": memory.get("Budget") or "",
        "hostel": memory.get("Hostel") or "",
        "transport": memory.get("Transport") or "",
    }
    # If nothing was captured in memory, fall back to a light transcript scan.
    t = transcript.lower() if transcript else ""
    if not fields["caller_name"]:
        m = re.search(r"(?:my name is|i'm|call me|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", transcript)
        if m:
            fields["caller_name"] = m.group(1)
    if not fields["student_name"]:
        m = re.search(r"(?:my (?:daughter|son|child|kids?)(?:'s)?\s+name is|call her|her name is|his name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", transcript)
        if m:
            fields["student_name"] = m.group(1)
    if not fields["student_class"] and re.search(r"(?:class|grade|std)\s*[viiiixx0-9]{1,3}", t):
        m = re.search(r"(?:class|grade|std)[\s]+[viiiixx0-9]{1,3}", t)
        if m:
            fields["student_class"] = m.group(0).split()[-1].replace("std", "").replace("grade", "").replace("class", "").strip().upper()
    if not fields["course"]:
        for c in ["etechno", "echamps", "ekidz", "senior secondary", "cbse"]:
            if c in t:
                fields["course"] = c.title()
                break
    if not fields["location"] and re.search(r"(?:hyderabad|secunderabad|vizag|vijayawada|india)", t):
        m = re.search(r"(?:hyderabad|secunderabad|vizag|vijayawada|india)", t)
        if m:
            fields["location"] = m.group(0).title()
    if not fields["hostel"]:
        if any(w in t for w in ["hostel", "boarding", "residence"]):
            fields["hostel"] = "Interested" if any(w in t for w in ["want", "need", "interested", "yes"]) else "Asked about availability"
    if not fields["transport"]:
        if any(w in t for w in ["transport", "bus", "van", "pickup", "drop"]):
            fields["transport"] = "Asked about availability"
    return fields


def _build_summary(
    fields: dict,
    transcript: str,
    questions: list[str],
    intent: str,
) -> str:
    """2-3 sentence narrative for the report (spec §32 example style)."""
    parts: list[str] = []
    caller = fields.get("caller_name") or "Caller"
    student = fields.get("student_name")
    cls = fields.get("student_class")
    course = fields.get("course")
    hostel = fields.get("hostel")
    transport = fields.get("transport")

    sentence1 = f"Caller is {caller}."
    if student:
        sentence1 += f" They were enquiring about {student}"
        if cls:
            sentence1 += f" (Class {cls})"
        sentence1 += "."
    if course:
        sentence1 += f" They showed interest in the {course} programme."

    sentence2_parts: list[str] = []
    if questions:
        qtext = "; ".join(questions[:4])
        sentence2_parts.append(f"They asked about {qtext.lower()}.")
    if hostel and hostel != "No":
        sentence2_parts.append(f"Hostel: {hostel}.")
    if transport and transport != "No":
        sentence2_parts.append(f"Transport: {transport}.")
    if sentence2_parts:
        sentence2 = " " + " ".join(sentence2_parts)
    else:
        sentence2 = " They had a brief conversation."

    sentence3 = _closing_sentence(intent, fields)
    return sentence1 + sentence2 + sentence3


def _closing_sentence(intent: str, fields: dict) -> str:
    """Natural closing line per spec §31 / §51."""
    next_action = fields.get("next_action")
    if intent == "HOT" and next_action:
        return f" Next action: {next_action}."
    if intent == "HOT":
        return " They appear ready to take the next step."
    if intent == "WARM":
        return " They are considering their options and may need more information."
    return " They are not currently ready to proceed."


def _compute_interest_score(
    intent: str,
    questions: list[str],
    hostel: Optional[str],
    transport: Optional[str],
) -> int:
    """0-100 AI-estimated interest (spec §31)."""
    score = 50
    if intent == "HOT":
        score += 25
    elif intent == "WARM":
        score += 10
    else:
        score -= 15
    score += min(len(questions) * 4, 15)
    if hostel and hostel not in ("No", ""):
        score += 5
    if transport and transport != "No":
        score += 3
    return max(0, min(100, score))


def _compute_conversion_probability(interest_score: int, intent: str) -> int:
    """0-100 AI-estimated conversion likelihood (spec §31)."""
    if intent == "HOT":
        return max(50, interest_score - 10)
    if intent == "WARM":
        return max(25, interest_score - 20)
    return max(5, interest_score - 30)


def _intent_to_lead_status(intent: str) -> str:
    return {"HOT": "HOT LEAD", "WARM": "WARM LEAD", "COLD": "COLD LEAD"}.get(intent, "NEW")


def _next_action_for_intent(intent: str, hostel: Optional[str], transport: Optional[str]) -> str:
    if intent == "HOT":
        if hostel and hostel not in ("No", ""):
            return "Campus visit (hostel tour)"
        return "Campus visit"
    if intent == "WARM":
        if transport and transport != "No":
            return "Send transport + fee information"
        return "Send information + callback"
    return "Callback"


def generate_report_data(
    call_id: str,
    institute_id: int,
    institute_name: str,
    transcript: str,
    memory: dict,
    detected_language: Optional[str],
    sentiment: Optional[Sentiment],
    duration_seconds: int,
) -> dict:
    """Assemble the CallReport fields from the call artifacts (spec §32)."""
    fields = _extract_lead_fields(transcript, memory, institute_name)
    questions = _questions_from_transcript(transcript)
    intent = _lead_intent_from_transcript(transcript)
    interest = _compute_interest_score(intent, questions, fields.get("hostel"), fields.get("transport"))
    conversion = _compute_conversion_probability(interest, intent)
    next_action = _next_action_for_intent(intent, fields.get("hostel"), fields.get("transport"))
    summary = _build_summary(fields, transcript, questions, intent)

    return {
        "call_id": call_id,
        "institute_id": institute_id,
        "caller_name": fields["caller_name"] or None,
        "student_name": fields["student_name"] or None,
        "student_class": fields["student_class"] or None,
        "course": fields["course"] or None,
        "location": fields["location"] or None,
        "budget": fields["budget"] or None,
        "hostel": fields["hostel"] or "Not mentioned",
        "transport": fields["transport"] or "Not mentioned",
        "interest_score": interest,
        "conversion_probability": conversion,
        "intent": intent,
        "lead_status": _intent_to_lead_status(intent),
        "objections": [] if not transcript else _simple_objections(transcript),
        "next_action": next_action,
        "summary": summary,
        "questions_asked": questions or None,
    }


def _simple_objections(transcript: str) -> list[str]:
    """Lightweight objection detection from transcript."""
    t = transcript.lower()
    objections: list[str] = []
    if any(w in t for w in ["fee", "cost", "expensive", "afford", "price"]):
        objections.append("Fee clarification")
    if any(w in t for w in ["location", "far", "distance", "commute"]):
        objections.append("Location")
    if any(w in t for w in ["hostel", "boarding", "residence"]):
        objections.append("Hostel")
    if any(w in t for w in ["transport", "bus", "van", "pickup"]):
        objections.append("Transport")
    if any(w in t for w in ["timing", "hours", "schedule", "timing issue"]):
        objections.append("Timing")
    if any(w in t for w in ["parent", "father", "mother", " husband", "wife"]):
        objections.append("Parent approval")
    return objections or ["None noted"]


async def generate_and_persist_report(
    session: AsyncSession,
    call: CallHistory,
    institute_name: str,
    transcript: str,
    memory: dict,
) -> CallReport:
    """Create + persist a CallReport for a completed call (spec §32)."""
    data = generate_report_data(
        call_id=call.call_id,
        institute_id=call.institute_id,
        institute_name=institute_name,
        transcript=transcript,
        memory=memory,
        detected_language=call.detected_language,
        sentiment=call.sentiment,
        duration_seconds=call.duration_seconds or 0,
    )
    report = CallReport(**data)
    call.report = report
    await session.commit()
    await session.refresh(report)
    logger.info(
        "CALL_REPORT | call=%s | interest=%d%% | conversion=%d%% | intent=%s | next=%s",
        call.call_id, data["interest_score"],
        data["conversion_probability"], data["intent"], data["next_action"],
    )
    return report
