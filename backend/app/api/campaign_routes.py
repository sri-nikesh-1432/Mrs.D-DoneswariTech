"""
Campaign & Calling Queue API Routes for Doneswari AI Telecaller Platform.

REAL CALLS ONLY (spec §31 §55 §56):
  - The calling queue initiates REAL outbound phone calls through the
    configured telephony provider (Twilio/Exotel). If telephony is not
    configured the start endpoint fails with a clear error — it never fakes
    a calling screen or fabricates call data.
  - The dry-run (demo) call executes the agent's REAL runtime: the actual
    greeting, actual RAG retrieval against the agent's own vector store,
    actual LLM answers, and measured latencies. Only the student's voice is
    role-played by an LLM, and the resulting call is explicitly labelled
    provider="dry_run" so it can never be confused with a real phone call.
    No scripted dialogues, no random latencies, no hardcoded answers.
"""

import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import (
    Institute, Student, CallHistory, CallReport, QuestionRanking,
    TranscriptMessage, CallEvent, InterestLevel, AgentStatus
)
from app.api.auth_routes import get_current_user_optional, require_ownership
from app.rag.retriever import retrieve_context, format_context_for_prompt
from app.rag.groq_service import _create_with_fallback, stream_chat_fast
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Campaigns"])

# Active background runners: agent_id -> bool
_active_campaigns: Dict[int, bool] = {}


# ── Shared post-call intelligence ─────────────────────────────────────────────

async def analyze_conversation(
    transcript: str,
    agent_name: str,
    student_name: str,
    preferred_course: Optional[str] = None,
) -> Dict:
    """
    Extract structured business intelligence from a REAL conversation
    transcript (spec §37). Falls back to conservative rule-based extraction
    when the LLM is unavailable — never invents data it cannot see.
    """
    if not transcript or len(transcript.strip()) < 10:
        return {
            "interest_level": "Unclear",
            "outcome": "Call Ended Early",
            "questions_asked": [],
            "objections": [],
            "callback_requested": False,
            "summary": "Brief connection without detailed conversation.",
        }

    analysis_prompt = f"""You are a professional telecalling QA auditor. Analyze this telephone conversation between admissions caller ({agent_name}) and student ({student_name}).

Conversation Transcript:
{transcript}

Extract the following in strict JSON format:
{{
  "interest_level": "Interested" | "Not Interested" | "Needs Follow-up" | "Callback Requested" | "Unclear",
  "outcome": "Brief 3-5 word outcome e.g. Follow-up Required, Admission Form Sent, Callback Arranged, Closed",
  "questions_asked": ["Specific question student asked 1", "Specific question 2"],
  "objections": ["Any concern or objection e.g. fees high, distance, comparing with other college"],
  "callback_requested": true or false,
  "summary": "A clear 2-sentence summary of the conversation."
}}

Only respond with the valid JSON object, no markdown, no other text."""

    try:
        messages = [
            {"role": "system", "content": "You are a precise JSON extractor."},
            {"role": "user", "content": analysis_prompt},
        ]
        resp = await _create_with_fallback(messages, temperature=0.1, max_tokens=400)
        content = resp.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        data = json.loads(content.strip())
        valid_interests = {"Interested", "Not Interested", "Needs Follow-up", "Callback Requested", "Unclear"}
        if data.get("interest_level") not in valid_interests:
            data["interest_level"] = "Needs Follow-up" if "follow" in str(data.get("interest_level", "")).lower() else "Unclear"
        return data
    except Exception as e:
        logger.warning("Automated call analysis fallback (LLM unavailable): %s", e)
        # Rule-based fallback on the REAL transcript only.
        t_lower = transcript.lower()
        interest = "Unclear"
        if any(w in t_lower for w in ["definitely", "send details", "join", "admission form", "yes interested", "fees structure"]):
            interest = "Interested"
        elif any(w in t_lower for w in ["not interested", "don't call", "already joined", "no thanks"]):
            interest = "Not Interested"
        elif any(w in t_lower for w in ["call back", "busy right now", "call later", "tomorrow"]):
            interest = "Callback Requested"

        questions = []
        if "fee" in t_lower or "cost" in t_lower: questions.append("Course Fees")
        if "hostel" in t_lower or "stay" in t_lower: questions.append("Hostel Availability")
        if "placement" in t_lower or "job" in t_lower: questions.append("Placement Details")
        if "eligibility" in t_lower or "marks" in t_lower: questions.append("Eligibility Criteria")

        return {
            "interest_level": interest,
            "outcome": "Follow-up Required" if interest == "Interested" else "Call Completed",
            "questions_asked": questions,
            "objections": ["Fee comparison"] if "expensive" in t_lower else [],
            "callback_requested": interest == "Callback Requested",
            "summary": f"Telecalling interaction with {student_name} regarding admissions.",
        }


async def _persist_call_results(
    session: AsyncSession,
    agent: Institute,
    student: Student,
    call_id: str,
    transcript_messages: List[Dict],
    analysis: Dict,
    latency: Dict,
    provider: str,
    provider_call_id: Optional[str],
    direction: str,
    call_status: str,
    duration_seconds: int,
) -> CallHistory:
    """Persist one completed call: CallHistory + speaker-attributed transcript
    messages + question rankings + agent/student counters (spec §36 §37 §41)."""
    full_transcript = "\n".join(
        f"{m['speaker']}: {m['text']}" for m in transcript_messages
    )
    interest_level = analysis.get("interest_level", "Unclear")
    call_status_final = (
        "Callback Requested" if analysis.get("callback_requested") else call_status
    )

    call_rec = CallHistory(
        call_id=call_id,
        institute_id=agent.id,
        student_id=student.id,
        caller_name=student.name,
        caller_number=student.phone,
        call_status=call_status_final,
        started_at=datetime.now(timezone.utc),
        ended_at=datetime.now(timezone.utc),
        duration_seconds=duration_seconds,
        transcript=full_transcript,
        summary=analysis.get("summary"),
        questions_asked=analysis.get("questions_asked", []),
        objections=analysis.get("objections", []),
        interest_level=interest_level,
        outcome=analysis.get("outcome", "Call Completed"),
        callback_requested=bool(analysis.get("callback_requested")),
        # REAL measured latencies (spec §6 §12) — None when not measured.
        avg_retrieval_time_ms=latency.get("retrieval_ms"),
        avg_llm_response_time_ms=latency.get("llm_ms"),
        avg_stt_time_ms=latency.get("stt_ms"),
        avg_tts_time_ms=latency.get("tts_ms"),
        total_latency_ms=latency.get("total_ms"),
        total_turns=len(transcript_messages),
        provider=provider,
        provider_call_id=provider_call_id,
        direction=direction,
    )
    session.add(call_rec)
    await session.flush()

    # Speaker-attributed transcript rows (spec §36).
    for seq, m in enumerate(transcript_messages):
        session.add(TranscriptMessage(
            call_id=call_id,
            agent_id=agent.id,
            sequence=seq,
            speaker=m["speaker"],
            text=m["text"],
            latency_ms=m.get("latency_ms"),
        ))

    # Real call event (spec §34).
    session.add(CallEvent(
        call_id=call_id,
        event_type="completed",
        source="pipeline" if provider == "dry_run" else "provider",
        provider_call_id=provider_call_id,
        detail={"provider": provider, "turns": len(transcript_messages)},
    ))

    # Update student record.
    student.call_status = call_status_final
    student.interest_level = interest_level
    student.duration_seconds = duration_seconds
    student.questions_asked = analysis.get("questions_asked", [])
    student.objections = analysis.get("objections", [])
    student.callback_requested = bool(analysis.get("callback_requested"))
    student.outcome = analysis.get("outcome", "Call Completed")
    student.last_called_at = datetime.now(timezone.utc)

    # Update agent counters.
    agent.total_calls = (agent.total_calls or 0) + 1
    if call_status_final == "Completed" or call_status_final == "Callback Requested":
        agent.completed_calls = (agent.completed_calls or 0) + 1
    agent.total_duration_seconds = (agent.total_duration_seconds or 0) + duration_seconds
    if interest_level == "Interested":
        agent.interested_count = (agent.interested_count or 0) + 1
    elif interest_level == "Not Interested":
        agent.not_interested_count = (agent.not_interested_count or 0) + 1
    elif interest_level == "Needs Follow-up":
        agent.follow_up_count = (agent.follow_up_count or 0) + 1
    elif interest_level == "Callback Requested":
        agent.callback_count = (agent.callback_count or 0) + 1

    # Update question rankings from REAL extracted questions (spec §42).
    for q in analysis.get("questions_asked", []):
        if not q:
            continue
        existing_q = await session.execute(
            select(QuestionRanking).where(
                QuestionRanking.agent_id == agent.id,
                QuestionRanking.question_text == q,
            )
        )
        qr = existing_q.scalar_one_or_none()
        if qr:
            qr.count = (qr.count or 1) + 1
            qr.last_asked_at = datetime.now(timezone.utc)
        else:
            session.add(QuestionRanking(
                agent_id=agent.id,
                question_text=q,
                count=1,
                last_asked_at=datetime.now(timezone.utc),
            ))

    return call_rec


# ── Dry-run call: the agent's REAL runtime, role-played student ───────────────

_MAX_DRY_RUN_TURNS = 6


async def _agent_reply(query: str, agent: Institute, history: List[Dict]) -> tuple[str, Dict]:
    """One REAL agent turn: RAG retrieval + grounded LLM answer, measured.
    This is the exact same retrieval+LLM path the live voice WebSocket uses."""
    from app.rag.groq_service import stream_chat_fast as _stream

    t0 = time.time()
    chunks = await retrieve_context(query, top_k=4, agent_id=agent.id)
    context = format_context_for_prompt(chunks)
    retrieval_ms = round((time.time() - t0) * 1000, 1)

    t1 = time.time()
    parts = []
    async for delta in _stream(
        query,
        lang="English",
        conversation_history=history,
        context=context,
        agent_name=agent.agent_name or agent.name,
        company_name=agent.name,
        instructions=agent.instructions,
    ):
        parts.append(delta)
    reply = " ".join("".join(parts).split())
    llm_ms = round((time.time() - t1) * 1000, 1)

    if not reply:
        reply = (
            "I don't have the exact information available right now. "
            "I can help with what I have, or arrange for a counsellor to provide the exact details."
        )
    return reply, {"retrieval_ms": retrieval_ms, "llm_ms": llm_ms, "grounded": bool(context)}


async def _student_reply(transcript: str, student: Student, agent: Institute) -> str:
    """Role-play the student for dry-run calls. The AGENT side is 100% real;
    this only simulates the human half so the demo exercises the full runtime."""
    persona = (
        f"You are {student.name}, a prospective student who received a call from "
        f"{agent.agent_name or agent.name} about admissions at {agent.name}. "
        + (f"You are interested in {student.preferred_course}. " if student.preferred_course else "")
        + "Behave like a real person on a phone call: ask 1 short realistic question at a time "
        "(fees, courses, hostel, admission process, timings — anything a student would ask). "
        "Sometimes give short acknowledgements. Reply with ONLY what you would SAY, nothing else. "
        "After 3-4 questions, politely wrap up the call."
    )
    messages = [
        {"role": "system", "content": persona},
        {"role": "user", "content": f"Conversation so far:\n{transcript}\n\nSay your next line:"},
    ]
    try:
        resp = await _create_with_fallback(messages, temperature=0.8, max_tokens=80)
        line = (resp.choices[0].message.content or "").strip()
        return line[:300] if line else "Okay, thank you."
    except Exception as e:
        logger.warning("Dry-run student turn failed: %s", e)
        return "Okay, thank you for the information."


async def conduct_dry_run_call(student_id: int, agent_id: int) -> Optional[Dict]:
    """
    Execute a DRY-RUN call exercising the agent's REAL runtime (spec §55:
    demo behaviour behind an explicit, labelled path):
      - real configured greeting
      - real RAG retrieval per turn (agent's own isolated vector store)
      - real grounded LLM answers (same code path as live voice calls)
      - measured latencies (no fabricated numbers)
      - real speaker-attributed transcript persisted
    The student's side is role-played by an LLM; the call is stored with
    provider="dry_run" and direction="outbound" so analytics can always
    distinguish demo runs from real phone calls.
    """
    async with AsyncSessionLocal() as session:
        student = await session.get(Student, student_id)
        agent = await session.get(Institute, agent_id)
        if not student or not agent:
            return None

        agent.status_check = None  # avoid accidental attribute creation
        call_id = f"dry_{uuid.uuid4().hex[:12]}"
        agent_name = agent.agent_name or agent.name or "Aadhya"
        company_name = agent.name or "Doneswari Technologies"

        student.call_status = "In Progress"
        student.last_called_at = datetime.now(timezone.utc)
        await session.commit()

        greeting = (agent.greeting_message or "").strip() or (
            f"Hi, this is {agent_name} from {company_name}. "
            "Is this a good time for a quick conversation?"
        )

        transcript_messages: List[Dict] = []
        history: List[Dict] = []
        latency = {"retrieval_ms": 0.0, "llm_ms": 0.0, "stt_ms": None, "tts_ms": None}
        t_start = time.time()

        # Turn 0: agent greeting (real configured greeting — no LLM needed).
        transcript_messages.append({"speaker": agent_name, "text": greeting})
        history.append({"role": "assistant", "content": greeting})

        for turn in range(_MAX_DRY_RUN_TURNS):
            student_line = await _student_reply(
                "\n".join(f"{m['speaker']}: {m['text']}" for m in transcript_messages),
                student, agent,
            )
            transcript_messages.append({"speaker": student.name, "text": student_line})
            history.append({"role": "user", "content": student_line})

            if any(w in student_line.lower() for w in ("thank you", "bye", "that's all", "thats all")):
                closing = f"Thank you for your time, {student.name}. Have a great day!"
                transcript_messages.append({"speaker": agent_name, "text": closing})
                break

            reply, lat = await _agent_reply(student_line, agent, history)
            transcript_messages.append({"speaker": agent_name, "text": reply, "latency_ms": int(lat["retrieval_ms"] + lat["llm_ms"])})
            history.append({"role": "assistant", "content": reply})
            latency["retrieval_ms"] += lat["retrieval_ms"]
            latency["llm_ms"] += lat["llm_ms"]

        duration = int(time.time() - t_start)
        agent_turns = sum(1 for m in transcript_messages if m["speaker"] == agent_name and m is not transcript_messages[0])
        if latency["retrieval_ms"] and agent_turns:
            latency["retrieval_ms"] = round(latency["retrieval_ms"] / agent_turns, 1)
            latency["llm_ms"] = round(latency["llm_ms"] / agent_turns, 1)
        latency["total_ms"] = round(latency["retrieval_ms"] + latency["llm_ms"], 1)

        full_transcript = "\n".join(f"{m['speaker']}: {m['text']}" for m in transcript_messages)
        analysis = await analyze_conversation(full_transcript, agent_name, student.name, student.preferred_course)
        analysis["simulated_student"] = True  # honest labelling for demo runs

        call_rec = await _persist_call_results(
            session, agent, student, call_id, transcript_messages, analysis,
            latency, provider="dry_run", provider_call_id=None,
            direction="outbound", call_status="Completed", duration_seconds=duration,
        )
        await session.commit()

        logger.info(
            "DRY_RUN call %s for student %s completed: %s (%d turns, %.1fs)",
            call_id, student.name, analysis.get("interest_level"),
            len(transcript_messages), duration,
        )
        return {
            "call_id": call_id,
            "call_status": call_rec.call_status,
            "interest_level": call_rec.interest_level,
            "duration_seconds": duration,
            "outcome": call_rec.outcome,
            "questions_asked": call_rec.questions_asked,
            "turns": len(transcript_messages),
            "latency_ms": latency["total_ms"],
        }


# ── REAL telephony call execution ─────────────────────────────────────────────

async def initiate_real_call(student_id: int, agent_id: int) -> Dict:
    """
    Initiate a REAL outbound phone call through the telephony provider
    (spec §31-§35). The provider calls the student's actual phone; call
    status and transcript come from provider events and the live media
    stream — never fabricated here.
    """
    from app.telephony.twilio_service import twilio_service

    async with AsyncSessionLocal() as session:
        student = await session.get(Student, student_id)
        agent = await session.get(Institute, agent_id)
        if not student or not agent:
            return {"ok": False, "error": "Student or agent not found"}

        max_attempts = max(1, settings.CALL_RETRY_ATTEMPTS)
        if (student.call_attempt_count or 0) >= max_attempts:
            student.call_status = "Failed"
            await session.commit()
            return {"ok": False, "error": f"Max call attempts ({max_attempts}) reached for {student.name}"}

        # Duplicate-call prevention (spec §26): a student already being called
        # (Calling/In Progress) must never receive a second concurrent call.
        active_status = (student.call_status or "").lower()
        if active_status in ("calling", "in progress", "in_progress"):
            return {"ok": False, "error": f"{student.name} is already on an active call"}

        call_id = f"call_{uuid.uuid4().hex[:12]}"
        student.call_status = "Calling"
        student.call_attempt_count = (student.call_attempt_count or 0) + 1
        student.last_called_at = datetime.now(timezone.utc)

        call = CallHistory(
            call_id=call_id,
            institute_id=agent.id,
            student_id=student.id,
            caller_name=student.name,
            caller_number=student.phone,
            call_status="Calling",
            started_at=datetime.now(timezone.utc),
            provider="twilio",
            direction="outbound",
        )
        session.add(call)
        await session.flush()
        session.add(CallEvent(
            call_id=call_id, event_type="queued", source="system",
            detail={"student": student.name, "attempt": student.call_attempt_count},
        ))
        await session.commit()

    try:
        result = await twilio_service.create_outbound_call(
            to_number=student.phone,
            agent_id=agent_id,
            call_id=call_id,
            student_name=student.name,
        )
    except Exception as e:
        # Provider call failed to initiate — record the real failure.
        async with AsyncSessionLocal() as session:
            c = await session.get(CallHistory, call_id, )
            if c is None:
                res = await session.execute(select(CallHistory).where(CallHistory.call_id == call_id))
                c = res.scalar_one_or_none()
            if c:
                c.call_status = "Failed"
                c.error_message = str(e)[:500]
                session.add(CallEvent(call_id=call_id, event_type="failed", source="provider", detail={"error": str(e)[:300]}))
            if student:
                student.call_status = "Failed"
            await session.commit()
        return {"ok": False, "error": f"Telephony provider error: {e}", "call_id": call_id}

    # Store the REAL provider call id (spec §32).
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(CallHistory).where(CallHistory.call_id == call_id))
        c = res.scalar_one_or_none()
        if c:
            c.provider_call_id = result.get("provider_call_id")
            session.add(CallEvent(
                call_id=call_id, event_type="initiating", source="provider",
                provider_call_id=result.get("provider_call_id"),
                detail={"status": result.get("status")},
            ))
            await session.commit()

    return {"ok": True, "call_id": call_id, "provider_call_id": result.get("provider_call_id"), "status": result.get("status")}


async def run_calling_queue(agent_id: int):
    """
    Background queue worker that initiates REAL provider calls sequentially
    with attempt counting and retry logic (spec §35).
    """
    from app.telephony.twilio_service import twilio_service

    _active_campaigns[agent_id] = True
    logger.info("Calling queue worker started for agent %d (REAL telephony calls)", agent_id)

    try:
        while _active_campaigns.get(agent_id, False):
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Student)
                    .where(Student.agent_id == agent_id, Student.call_status == "Pending")
                    .order_by(Student.id.asc())
                    .limit(1)
                )
                student = result.scalar_one_or_none()
                if not student:
                    logger.info("All pending students processed for agent %d", agent_id)
                    _active_campaigns[agent_id] = False
                    break
                student_id = student.id

            out = await initiate_real_call(student_id, agent_id)

            if out.get("ok"):
                # Wait for the call window before the next student (provider
                # status callbacks update each call's real state meanwhile).
                await asyncio.sleep(settings.CALL_TIMEOUT_SECONDS)
            else:
                logger.warning("Real call failed for student %d: %s", student_id, out.get("error"))
                # Retry policy (spec §72): No Answer / Busy / failed-initiation
                # are retried with a growing backoff until max attempts, then
                # left Failed. Never endlessly re-call.
                async with AsyncSessionLocal() as session:
                    s = await session.get(Student, student_id)
                    if s:
                        attempts = s.call_attempt_count or 0
                        if attempts < max(1, settings.CALL_RETRY_ATTEMPTS) and s.call_status in ("Failed", "No Answer", "Busy"):
                            s.call_status = "Pending"
                            backoff = min(2 * attempts, 60)  # 2s, 4s, 6s… capped 60s
                            await session.commit()
                            logger.info("Retry scheduled for student %d in %ss (attempt %d/%d)", student_id, backoff, attempts + 1, settings.CALL_RETRY_ATTEMPTS)
                            await asyncio.sleep(backoff)
                        else:
                            await asyncio.sleep(2)

    except Exception as e:
        logger.error("Error in calling queue worker for agent %d: %s", agent_id, e)
    finally:
        _active_campaigns[agent_id] = False


# ── Queue Endpoints ──────────────────────────────────────────────────────────

async def _owned_agent(
    agent_id: int,
    authorization,
    session: AsyncSession,
) -> Institute:
    """Tenant-isolation gate for campaign routes (spec §17)."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    return await require_ownership(user, agent)


@router.get("/api/agents/{agent_id}/campaign/status")
async def get_campaign_status(
    agent_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Get real-time Ready-to-Call counts and campaign progress (all from real DB state)."""
    agent = await _owned_agent(agent_id, authorization, session)

    status_counts = await session.execute(
        select(Student.call_status, func.count(Student.id))
        .where(Student.agent_id == agent_id)
        .group_by(Student.call_status)
    )
    counts = dict(status_counts.all())

    interest_counts = await session.execute(
        select(Student.interest_level, func.count(Student.id))
        .where(Student.agent_id == agent_id)
        .group_by(Student.interest_level)
    )
    interests = dict(interest_counts.all())

    total = sum(counts.values())
    pending = counts.get("Pending", 0)
    in_progress = counts.get("In Progress", 0) + counts.get("Calling", 0)
    completed = counts.get("Completed", 0) + counts.get("Callback Requested", 0)

    telephony_configured = False
    try:
        from app.telephony.twilio_service import twilio_service
        telephony_configured = twilio_service.is_configured()
    except Exception:
        telephony_configured = False

    return {
        "agent_id": agent_id,
        "agent_name": agent.agent_name or agent.name,
        "agent_status": agent.status,
        "is_running": _active_campaigns.get(agent_id, False),
        "telephony_configured": telephony_configured,
        "total_students": total,
        "ready_to_call": pending,
        "in_progress": in_progress,
        "completed": completed,
        "interested": interests.get("Interested", 0),
        "not_interested": interests.get("Not Interested", 0),
        "follow_up_required": interests.get("Needs Follow-up", 0),
        "callback_requested": counts.get("Callback Requested", 0),
        "failed": counts.get("Failed", 0) + counts.get("No Answer", 0) + counts.get("Busy", 0),
        "progress_percent": round((completed / max(total, 1)) * 100, 1),
    }


@router.post("/api/agents/{agent_id}/campaign/start")
async def start_calling_campaign(
    agent_id: int,
    background_tasks: BackgroundTasks,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Start the sequential calling queue. This initiates REAL phone calls
    through the configured telephony provider — it NEVER simulates.
    Returns a clear error when telephony is not configured (spec §54).
    """
    agent = await _owned_agent(agent_id, authorization, session)

    if agent.status not in (AgentStatus.PUBLISHED.value, AgentStatus.READY.value):
        raise HTTPException(
            status_code=400,
            detail=f"Agent must be PUBLISHED before starting real calls (current status: {agent.status}).",
        )

    from app.telephony.twilio_service import twilio_service
    if not twilio_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Real calling requires telephony credentials. Set TWILIO_ACCOUNT_SID, "
                "TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER in backend/.env — then this "
                "queue dials each student's real phone number. Use the Voice Test page "
                "or a dry-run call for testing without telephony."
            ),
        )

    pending_count = (await session.execute(
        select(func.count(Student.id)).where(Student.agent_id == agent_id, Student.call_status == "Pending")
    )).scalar() or 0

    if pending_count == 0:
        raise HTTPException(status_code=400, detail="No pending students in queue. Please add students first.")

    if _active_campaigns.get(agent_id, False):
        return {"message": "Calling queue is already active", "is_running": True}

    background_tasks.add_task(run_calling_queue, agent_id)

    return {
        "message": f"REAL calling campaign started for {pending_count} students — phones will ring via the telephony provider.",
        "is_running": True,
        "pending_count": pending_count,
    }


@router.post("/api/agents/{agent_id}/campaign/pause")
async def pause_calling_campaign(
    agent_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Pause the active calling queue (no further calls are initiated)."""
    await _owned_agent(agent_id, authorization, session)
    _active_campaigns[agent_id] = False
    return {"message": "Calling campaign paused.", "is_running": False}


@router.post("/api/agents/{agent_id}/campaign/dry-run-call/{student_id}")
async def dry_run_call_for_student(
    agent_id: int,
    student_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Run a DRY-RUN call for one student through the agent's REAL runtime
    (real RAG + real LLM + measured latencies + real transcript). The
    student's side is role-played by an LLM and the result is labelled
    provider="dry_run" — this is a labelled demo tool, never shown as a
    real phone call.
    """
    agent = await _owned_agent(agent_id, authorization, session)
    student = await session.get(Student, student_id)
    if not student or student.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Student not found")

    result = await conduct_dry_run_call(student_id, agent_id)
    if not result:
        raise HTTPException(status_code=500, detail="Dry-run call failed")

    await session.commit()
    return {"message": f"Dry-run call completed for {student.name}", **result}
