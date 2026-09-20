"""
Analytics API Routes for Doneswari AI Telecaller Platform.

REAL DATA ONLY (spec §39 §40 §41 §55):
Every metric on this dashboard is computed from real call records in the
database. There are NO hardcoded statistics, NO fabricated defaults, and NO
placeholder distributions. When no calls exist the API says so and the UI
shows "No calls yet".
"""

from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database
from app.database.models import (
    Institute, Student, CallHistory, CallReport, QuestionRanking
)
from app.api.auth_routes import get_current_user_optional, require_ownership
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Analytics"])


# ── Question normalization (spec §42) ────────────────────────────────────────

def _normalize_question_topic(question: str) -> str:
    """
    Map semantically similar questions to one normalized topic so
    "What is the MPC fee?" / "How much does MPC cost?" both count under
    the same topic. Keyword-bucket based — real occurrences, real counts,
    no hardcoded analytics.
    """
    q = (question or "").lower()
    if any(w in q for w in ("fee", "fees", "cost", "price", "charges", "expensive", "tuition", "scholarship", "discount")):
        return "Fees & Scholarships"
    if any(w in q for w in ("hostel", "accommodation", "boarding", "lodging", "stay")):
        return "Hostel & Accommodation"
    if any(w in q for w in ("admission", "apply", "enroll", "enrol", "join", "form", "process")):
        return "Admission Process"
    if any(w in q for w in ("course", "stream", "program", "mpc", "bipc", "mec", "cec", "subjects")):
        return "Courses & Subjects"
    if any(w in q for w in ("eligib", "qualification", "criteria", "marks", "percentage", "rank")):
        return "Eligibility Criteria"
    if any(w in q for w in ("placement", "job", "recruit", "career", "package")):
        return "Placements"
    if any(w in q for w in ("timing", "schedule", "hours", "batch", "when", "date", "last date", "deadline")):
        return "Timings & Dates"
    if any(w in q for w in ("location", "branch", "address", "where", "campus", "transport", "bus")):
        return "Location & Transport"
    if any(w in q for w in ("faculty", "teacher", "staff", "experienced")):
        return "Faculty"
    if any(w in q for w in ("results", "rank", "topper", "score", "board")):
        return "Results & Rankings"
    if any(w in q for w in ("counsellor", "counselor", "human", "speak to", "callback", "call back")):
        return "Counsellor / Callback"
    # Not matching a bucket → keep the original wording (still real).
    return (question or "Other").strip().title()[:80]


# ── Overall Agent Analytics Dashboard ────────────────────────────────────────

@router.get("/api/agents/{agent_id}/analytics")
async def get_agent_overall_analytics(
    agent_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Complete dashboard metrics computed from REAL call records:
    - KPI cards
    - Interest Distribution (donut)
    - Call Outcomes (bar)
    - Calls Over Time (trend)
    - Most Asked Questions (normalized topics, real counts)
    - Latency observability (measured values only)
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

    # 1. Total students count
    total_students = (await session.execute(
        select(func.count(Student.id)).where(Student.agent_id == agent_id)
    )).scalar() or 0

    # 2. Real calls for this agent
    calls_res = await session.execute(
        select(CallHistory).where(CallHistory.institute_id == agent_id).order_by(CallHistory.started_at.desc())
    )
    calls = calls_res.scalars().all()

    total_calls = len(calls)
    completed_calls = len([c for c in calls if str(c.call_status).lower() in ("completed", "callback requested")])
    callbacks_count = len([c for c in calls if c.callback_requested or str(c.call_status).lower() == "callback requested"])
    no_answer_count = len([c for c in calls if str(c.call_status).lower() in ("no_answer", "no answer", "failed", "busy", "missed", "cancelled")])

    # ── No calls yet: return honest empty state (spec §41 §55) ──
    if total_calls == 0:
        return {
            "agent_name": agent.agent_name or agent.name,
            "company_name": agent.name,
            "has_data": False,
            "message": "No calls yet — analytics will appear here after real calls are made.",
            "cards": {
                "total_students": total_students,
                "total_calls": 0,
                "completed_calls": 0,
                "interested": 0,
                "not_interested": 0,
                "follow_ups": 0,
                "callbacks": 0,
                "no_answer": 0,
                "average_duration": "0:00",
                "average_duration_seconds": 0,
            },
            "interest_distribution": [],
            "call_outcomes": [],
            "most_asked_questions": [],
            "calls_over_time": [],
            "latency_metrics": None,
        }

    # Interest classification from REAL call outcomes.
    interest_counter = Counter([(c.interest_level or "Unclear") for c in calls])
    interested = interest_counter.get("Interested", 0)
    not_interested = interest_counter.get("Not Interested", 0)
    follow_ups = interest_counter.get("Needs Follow-up", 0)
    callback_interest = interest_counter.get("Callback Requested", 0)
    unclear = interest_counter.get("Unclear", 0)

    # Average duration (real).
    durations = [c.duration_seconds for c in calls if c.duration_seconds and c.duration_seconds > 0]
    avg_duration_sec = round(sum(durations) / len(durations)) if durations else 0
    m, s = divmod(avg_duration_sec, 60)
    avg_duration_formatted = f"{m}:{s:02d}"

    # Interest distribution (real values only — no placeholder injection).
    interest_distribution = [
        {"name": "Interested", "value": interested, "color": "#10b981"},
        {"name": "Needs Follow-up", "value": follow_ups, "color": "#3b82f6"},
        {"name": "Not Interested", "value": not_interested, "color": "#ef4444"},
        {"name": "Callback Requested", "value": callbacks_count or callback_interest, "color": "#f59e0b"},
        {"name": "Unclear", "value": unclear, "color": "#6b7280"},
    ]
    interest_distribution = [d for d in interest_distribution if d["value"] > 0]

    # Call outcomes — real outcome strings grouped into buckets (spec §40).
    def _outcome_bucket(outcome: Optional[str]) -> str:
        o = (outcome or "").lower()
        if not o:
            return "Other"
        if any(w in o for w in ("follow", "interested")):
            return "Follow-up Required"
        if any(w in o for w in ("callback", "call back")):
            return "Callback Arranged"
        if any(w in o for w in ("not interested", "closed", "declined")):
            return "Closed / Not Interested"
        if any(w in o for w in ("form", "admission", "sent")):
            return "Admission Progressed"
        return outcome[:40] if outcome else "Other"

    outcome_counter = Counter(_outcome_bucket(c.outcome) for c in calls)
    call_outcomes = [{"outcome": k, "count": v} for k, v in outcome_counter.most_common(6)]

    # Most asked questions — normalized topics with REAL counts (spec §42).
    qr_res = await session.execute(
        select(QuestionRanking).where(QuestionRanking.agent_id == agent_id)
    )
    rankings = qr_res.scalars().all()
    if rankings:
        topic_counts: Counter = Counter()
        for r in rankings:
            topic = _normalize_question_topic(r.question_text)
            topic_counts[topic] += (r.count or 1)
        most_asked_questions = [
            {"question": topic, "count": count}
            for topic, count in topic_counts.most_common(6)
        ]
    else:
        most_asked_questions = []

    # Calls over time (past 7 days, real counts).
    now = datetime.now(timezone.utc)
    calls_over_time = []
    for day_offset in range(6, -1, -1):
        target_date = now - timedelta(days=day_offset)
        d_str = target_date.strftime("%b %d")
        day_count = len([
            c for c in calls
            if c.started_at and c.started_at.strftime("%b %d") == d_str
        ])
        calls_over_time.append({"date": d_str, "calls": day_count})

    # Latency observability — measured values only (spec §6 §12); None when
    # no real measurements exist (spec §55: no fake defaults).
    stt_lats = [c.avg_stt_time_ms for c in calls if c.avg_stt_time_ms]
    ret_lats = [c.avg_retrieval_time_ms for c in calls if c.avg_retrieval_time_ms]
    llm_lats = [c.avg_llm_response_time_ms for c in calls if c.avg_llm_response_time_ms]
    tts_lats = [c.avg_tts_time_ms for c in calls if c.avg_tts_time_ms]

    latency_metrics = None
    if stt_lats or ret_lats or llm_lats or tts_lats:
        latency_metrics = {
            "avg_stt_ms": round(sum(stt_lats) / len(stt_lats)) if stt_lats else None,
            "avg_retrieval_ms": round(sum(ret_lats) / len(ret_lats)) if ret_lats else None,
            "avg_llm_ms": round(sum(llm_lats) / len(llm_lats)) if llm_lats else None,
            "avg_tts_ms": round(sum(tts_lats) / len(tts_lats)) if tts_lats else None,
            "samples": max(len(stt_lats), len(ret_lats), len(llm_lats), len(tts_lats)),
        }

    return {
        "agent_name": agent.agent_name or agent.name,
        "company_name": agent.name,
        "has_data": True,
        "cards": {
            "total_students": total_students,
            "total_calls": total_calls,
            "completed_calls": completed_calls,
            "interested": interested,
            "not_interested": not_interested,
            "follow_ups": follow_ups,
            "callbacks": callbacks_count,
            "no_answer": no_answer_count,
            "average_duration": avg_duration_formatted,
            "average_duration_seconds": avg_duration_sec,
        },
        "interest_distribution": interest_distribution,
        "call_outcomes": call_outcomes,
        "most_asked_questions": most_asked_questions,
        "calls_over_time": calls_over_time,
        "latency_metrics": latency_metrics,
    }


# ── Student-Level Analytics ──────────────────────────────────────────────────

@router.get("/api/agents/{agent_id}/students/{student_id}/analytics")
async def get_student_detail_analytics(
    agent_id: int,
    student_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Single student's complete profile from REAL call records:
    demographics, call history with full transcripts, questions, objections,
    callback details.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)
    student = await session.get(Student, student_id)
    if not student or student.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Student not found")

    calls_res = await session.execute(
        select(CallHistory)
        .where(CallHistory.student_id == student_id)
        .order_by(CallHistory.started_at.desc())
    )
    student_calls = calls_res.scalars().all()

    from app.database.models import TranscriptMessage
    calls_data = []
    for c in student_calls:
        # Structured transcript messages when available (real speaker turns).
        msgs_res = await session.execute(
            select(TranscriptMessage)
            .where(TranscriptMessage.call_id == c.call_id)
            .order_by(TranscriptMessage.id.asc())
        )
        messages = [
            {"speaker": m.speaker, "text": m.text, "latency_ms": m.latency_ms}
            for m in msgs_res.scalars().all()
        ]
        calls_data.append({
            "id": c.call_id,
            "call_status": c.call_status,
            "provider": c.provider,
            "direction": c.direction,
            "date": c.started_at.strftime("%b %d, %Y %I:%M %p") if c.started_at else "",
            "duration_seconds": c.duration_seconds,
            "transcript": c.transcript,
            "transcript_messages": messages,
            "summary": c.summary,
            "questions_asked": c.questions_asked or [],
            "objections": c.objections or [],
            "interest_level": c.interest_level,
            "outcome": c.outcome,
            "total_latency_ms": c.total_latency_ms,
        })

    return {
        "student": {
            "id": student.id,
            "name": student.name,
            "phone": student.phone,
            "email": student.email,
            "preferred_course": student.preferred_course,
            "city": student.city,
            "call_status": student.call_status,
            "interest_level": student.interest_level,
            "duration_seconds": student.duration_seconds,
            "call_attempt_count": student.call_attempt_count or 0,
            "questions_asked": student.questions_asked or [],
            "objections": student.objections or [],
            "callback_requested": student.callback_requested,
            "outcome": student.outcome,
            "notes": student.notes,
            "last_called_at": student.last_called_at.isoformat() if student.last_called_at else None,
        },
        "calls": calls_data,
    }


# ── Full Call History with Latency Audit ─────────────────────────────────────

@router.get("/api/agents/{agent_id}/calls")
async def get_agent_call_history(
    agent_id: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Full call history for an agent with per-component latency metrics
    (STT, Retrieval, LLM, TTS) for observability and auditing.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

    result = await session.execute(
        select(CallHistory)
        .where(CallHistory.institute_id == agent_id)
        .order_by(CallHistory.started_at.desc())
        .offset(offset)
        .limit(limit)
    )
    calls = result.scalars().all()

    total = (await session.execute(
        select(func.count(CallHistory.id)).where(CallHistory.institute_id == agent_id)
    )).scalar() or 0

    return {
        "total": total,
        "calls": [
            {
                "id": c.id,
                "call_id": c.call_id,
                "student_id": c.student_id,
                "caller_name": c.caller_name,
                "caller_number": c.caller_number,
                "call_status": c.call_status,
                "provider": c.provider,
                "provider_call_id": c.provider_call_id,
                "direction": c.direction,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "ended_at": c.ended_at.isoformat() if c.ended_at else None,
                "duration_seconds": c.duration_seconds,
                "interest_level": c.interest_level,
                "outcome": c.outcome,
                "callback_requested": c.callback_requested,
                "summary": c.summary,
                "questions_asked": c.questions_asked or [],
                "objections": c.objections or [],
                "latency": {
                    "stt_ms": c.avg_stt_time_ms,
                    "retrieval_ms": c.avg_retrieval_time_ms,
                    "llm_ms": c.avg_llm_response_time_ms,
                    "tts_ms": c.avg_tts_time_ms,
                    "total_ms": c.total_latency_ms,
                },
                "total_turns": c.total_turns,
            }
            for c in calls
        ],
    }


# ── Voice Latency Dashboard (spec: STRICT 700ms LATENCY REQUIREMENT) ─────

@router.get("/api/agents/{agent_id}/latency-dashboard")
async def latency_dashboard(
    agent_id: int,
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Internal developer performance view (spec §60 + latency spec):
    avg / median / P90 / P95 / max first-audio latency, % turns ≤700ms,
    and the per-stage breakdown — ALL from real measured TurnLatency rows.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

    from app.rag.latency_recorder import get_latency_dashboard
    return await get_latency_dashboard(agent_id)


# ── Retrieval Debug / RAG Evaluation (spec §14 §47) ─────────────────────

@router.get("/api/agents/{agent_id}/retrieval-debug")
async def retrieval_debug(
    agent_id: int,
    q: str = Query(..., min_length=2, description="Test question"),
    top_k: int = Query(6, ge=1, le=20),
    include_answer: bool = Query(False, description="Also run the grounded LLM answer"),
    authorization: str = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Internal retrieval/debug view (spec §14): shows exactly what the
    retrieval pipeline does with a question —
      user question → normalized/rewritten query → retrieved chunks
      (document, page, section, score) → reranked context → final context
      → (optional) final grounded answer.
    Makes retrieval failures diagnosable without guessing.
    """
    from app.rag.retriever import (
        retrieve_context, format_context_for_prompt, rewrite_query,
    )
    from app.rag.reranker import rerank_chunks

    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

    normalized_query = " ".join(q.split())
    rewritten_query = rewrite_query(q)

    chunks = await retrieve_context(q, top_k=top_k * 2, agent_id=agent_id)
    reranked = rerank_chunks(q, chunks, top_k=top_k)
    final_context = format_context_for_prompt(reranked)

    response = {
        "agent_id": agent_id,
        "query": q,
        "normalized_query": normalized_query,
        "rewritten_query": rewritten_query,
        "knowledge_ready": bool(chunks),
        "retrieved_count": len(chunks),
        "retrieved": [
            {
                "chunk_id": c.get("chunk_id"),
                "document": c.get("source") or c.get("document"),
                "document_id": c.get("document_id"),
                "document_version_id": c.get("document_version_id"),
                "page": c.get("page_number"),
                "end_page": c.get("end_page"),
                "section": c.get("section"),
                "score": round(c.get("score", 0), 4),
                "bm25_rank": c.get("bm25_rank"),
                "rerank_score": round(c.get("rerank_score", 0), 4) if c.get("rerank_score") else None,
                "text_preview": (c.get("text") or "")[:280],
            }
            for c in chunks
        ],
        "reranked": [
            {
                "chunk_id": c.get("chunk_id"),
                "document": c.get("source") or c.get("document"),
                "page": c.get("page_number"),
                "section": c.get("section"),
                "rerank_score": c.get("rerank_score"),
                "relevance_signals": c.get("relevance_signals"),
                "text_preview": (c.get("text") or "")[:280],
            }
            for c in reranked
        ],
        "reranked_order": [c.get("chunk_id") for c in reranked],
        "final_context": final_context[:4000],
    }

    # Optional: run the SAME grounded LLM path used by the live agent so the
    # debug view can show the final answer, not just the context (spec §14).
    if include_answer:
        try:
            from app.rag.groq_service import stream_chat_fast
            parts: list = []
            async for token in stream_chat_fast(
                q,
                lang="English",
                conversation_history=[],
                context=final_context,
                agent_name=agent.agent_name,
                company_name=agent.name,
                instructions=agent.instructions,
            ):
                parts.append(token)
            response["answer"] = "".join(parts).strip()
            response["grounded"] = bool(final_context)
        except Exception as e:
            response["answer_error"] = str(e)[:300]

    return response
