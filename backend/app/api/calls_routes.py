"""
Calls API Routes
Serves call history and per-call reports.

Endpoints:
  GET /api/calls                  — list calls (filtered by institute_id)
  GET /api/calls/{call_id}        — single call detail
  GET /api/calls/{call_id}/report — structured call report
  POST /api/calls/outbound        — initiate outbound test call
  GET /api/analytics/stats        — aggregate stats
  GET /api/analytics/trend        — day-by-day trend data
"""

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database
from app.database.models import (
    CallHistory, CallReport, CallStatus, Institute, CallAnalytics
)
from app.api.auth_routes import get_current_user_optional, require_ownership
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Calls"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _format_duration(seconds: int) -> str:
    if not seconds:
        return "0:00"
    m, s = divmod(seconds, 60)
    return f"{m}:{s:02d}"


def _serialize_call(call: CallHistory, report: Optional[CallReport] = None) -> dict:
    """Convert a CallHistory ORM row to the shape the frontend expects."""
    lead_status = "COLD"
    interest_score = 0
    conversion = 0
    course = None
    next_action = None
    summary = call.summary or ""
    objections = []
    questions = call.questions_asked or []
    caller_name = call.caller_name or "Unknown"
    student_name = None
    student_class = None

    if report:
        interest_score = report.interest_score or 0
        conversion = report.conversion_probability or 0
        course = report.course
        next_action = report.next_action
        objections = report.objections or []
        questions = report.questions_asked or questions
        caller_name = report.caller_name or caller_name
        student_name = report.student_name
        student_class = report.student_class
        if interest_score >= 70:
            lead_status = "HOT"
        elif interest_score >= 40:
            lead_status = "WARM"
        else:
            lead_status = "COLD"
        lead_status = report.intent or lead_status

    return {
        "id": call.call_id,
        "caller_name": caller_name,
        "caller_phone": call.caller_number,
        "date": call.started_at.strftime("%b %d, %Y") if call.started_at else "",
        "duration": _format_duration(call.duration_seconds or 0),
        "language": call.detected_language or "English",
        "interest_score": interest_score,
        "conversion_likelihood": conversion,
        "lead_status": lead_status,
        "course": course,
        "outcome": _outcome_label(call.call_status),
        "summary": summary,
        "transcript": _parse_transcript(call.transcript),
        "questions_asked": questions,
        "objections": objections,
        "next_action": next_action,
        "lead": {
            "caller_name": caller_name,
            "student_name": student_name,
            "student_class": student_class,
            "course_interest": course,
            "hostel": report.hostel if report else None,
            "transport": report.transport if report else None,
            "location": report.location if report else None,
            "budget": report.budget if report else None,
        } if report else {},
    }


def _outcome_label(status) -> str:
    """Map a call status (enum OR plain string, per spec §21) to a display label."""
    if status is None:
        return "Unknown"
    # Accept both CallStatus enums and plain strings — call_status is stored
    # as a VARCHAR, so raw strings are the common case.
    key = status.value if hasattr(status, "value") else str(status)
    mapping = {
        "completed": "Completed",
        "missed": "Missed",
        "failed": "Failed",
        "answered": "Answered",
        "callback requested": "Callback Requested",
    }
    return mapping.get(key.lower(), str(key).title())


def _parse_transcript(raw: Optional[str]) -> list:
    if not raw:
        return []
    lines = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("User:") or line.startswith("Caller:"):
            lines.append({"role": "user", "content": line.split(":", 1)[-1].strip(), "timestamp": ""})
        elif line.startswith("Mrs.D:") or line.startswith("Agent:") or line.startswith("AI:"):
            lines.append({"role": "assistant", "content": line.split(":", 1)[-1].strip(), "timestamp": ""})
        else:
            lines.append({"role": "assistant", "content": line, "timestamp": ""})
    return lines


# ─── List calls ──────────────────────────────────────────────────────────────

@router.get("/api/calls")
async def list_calls(
    institute_id: Optional[int] = Query(None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    user = await get_current_user_optional(authorization, session)
    if not user:
        from fastapi import status as _status
        raise HTTPException(
            status_code=_status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    query = select(CallHistory)
    if institute_id:
        # Tenant isolation (spec §17): the agent must belong to the caller.
        agent = await session.get(Institute, institute_id)
        await require_ownership(user, agent)
        query = query.where(CallHistory.institute_id == institute_id)
    else:
        # No agent filter → only calls of the user's own agents.
        own_ids = (await session.execute(
            select(Institute.id).where(Institute.user_id == user.id)
        )).scalars().all()
        query = query.where(CallHistory.institute_id.in_(own_ids or [-1]))
    query = query.order_by(CallHistory.started_at.desc()).limit(limit).offset(offset)

    result = await session.execute(query)
    calls = result.scalars().all()

    rows = []
    for call in calls:
        # Load report
        rq = await session.execute(
            select(CallReport).where(CallReport.call_id == call.call_id)
        )
        report = rq.scalar_one_or_none()
        rows.append(_serialize_call(call, report))

    return rows


# ─── Single call ─────────────────────────────────────────────────────────────

@router.get("/api/calls/{call_id}")
async def get_call(
    call_id: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    result = await session.execute(
        select(CallHistory).where(CallHistory.call_id == call_id)
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, call.institute_id)
    await require_ownership(user, agent)

    rq = await session.execute(
        select(CallReport).where(CallReport.call_id == call_id)
    )
    report = rq.scalar_one_or_none()
    return _serialize_call(call, report)


# ─── Call report ─────────────────────────────────────────────────────────────

@router.get("/api/calls/{call_id}/report")
async def get_call_report(
    call_id: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    result = await session.execute(
        select(CallHistory).where(CallHistory.call_id == call_id)
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, call.institute_id)
    await require_ownership(user, agent)

    rq = await session.execute(
        select(CallReport).where(CallReport.call_id == call_id)
    )
    report = rq.scalar_one_or_none()
    serialized = _serialize_call(call, report)

    # Add extended report fields
    if report:
        serialized["interest_score"] = report.interest_score or 0
        serialized["conversion_likelihood"] = report.conversion_probability or 0
        serialized["lead_status"] = report.intent or "COLD"
        serialized["next_action"] = report.next_action
        serialized["objections"] = report.objections or []
        serialized["summary"] = call.summary or report.summary or ""
        serialized["ai_note"] = "AI-estimated interest and conversion scores. Not a guaranteed prediction."

    return serialized


# ─── Outbound test call ───────────────────────────────────────────────────────

class OutboundCallRequest(BaseModel):
    institute_id: int
    phone_number: str


@router.post("/api/calls/outbound")
async def initiate_outbound_call(
    body: OutboundCallRequest,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Initiate a REAL outbound test call (spec §31 §33 §55).

    NO SIMULATION: if telephony is not configured this fails with a clear
    503 explaining exactly which credentials are missing. Use the agent
    test-call endpoint (POST /api/agents/{id}/test-call) for the full
    validated flow — this legacy route now delegates to the same real
    Twilio service so both paths place genuine phone calls.
    """
    from app.config.settings import settings
    from app.telephony.twilio_service import twilio_service, validate_phone_number

    # Validate institute (tenant-isolated)
    user = await get_current_user_optional(authorization, session)
    result = await session.execute(
        select(Institute).where(Institute.id == body.institute_id)
    )
    institute = result.scalar_one_or_none()
    await require_ownership(user, institute)

    # Real telephony required — never simulate (spec §31 §55).
    if not twilio_service.is_configured():
        raise HTTPException(status_code=503, detail=twilio_service.configuration_error())

    validation = validate_phone_number(body.phone_number)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail=validation["error"])

    call_id = f"call_{uuid.uuid4().hex[:12]}"
    call_record = CallHistory(
        call_id=call_id,
        institute_id=body.institute_id,
        caller_number=validation["e164"],
        call_status="Calling",
        started_at=datetime.now(timezone.utc),
        provider="twilio",
        direction="outbound",
    )
    session.add(call_record)
    await session.commit()

    try:
        created = await twilio_service.create_outbound_call(
            to_number=validation["e164"],
            agent_id=body.institute_id,
            call_id=call_id,
        )
    except Exception as e:
        call_record.call_status = "Failed"
        call_record.error_message = str(e)[:500]
        await session.commit()
        raise HTTPException(status_code=502, detail=f"Telephony provider error: {e}")

    call_record.provider_call_id = created["provider_call_id"]
    await session.commit()
    logger.info("REAL outbound call placed: %s -> %s", created["provider_call_id"], validation["e164"])

    return {"call_id": call_id, "status": created["status"], "phone": validation["e164"]}


# ─── Analytics stats ─────────────────────────────────────────────────────────

@router.get("/api/analytics/stats")
async def get_analytics_stats(
    institute_id: Optional[int] = Query(None),
    session: AsyncSession = Depends(get_database),
):
    base_q = select(CallHistory)
    if institute_id:
        base_q = base_q.where(CallHistory.institute_id == institute_id)

    result = await session.execute(base_q)
    calls = result.scalars().all()

    total = len(calls)
    answered = sum(1 for c in calls if c.call_status not in (CallStatus.MISSED, CallStatus.FAILED))
    missed = sum(1 for c in calls if c.call_status == CallStatus.MISSED)
    total_dur = sum(c.duration_seconds or 0 for c in calls)
    avg_dur = total_dur / total if total else 0

    # Load reports for lead stats
    hot, warm, cold, interested = 0, 0, 0, 0
    for c in calls:
        rq = await session.execute(
            select(CallReport).where(CallReport.call_id == c.call_id)
        )
        rep = rq.scalar_one_or_none()
        if rep:
            score = rep.interest_score or 0
            if score >= 70:
                hot += 1
                interested += 1
            elif score >= 40:
                warm += 1
                interested += 1
            else:
                cold += 1

    conversion_rate = round((hot / total * 100) if total else 0)

    return {
        "total_calls": total,
        "answered_calls": answered,
        "missed_calls": missed,
        "hot_leads": hot,
        "warm_leads": warm,
        "cold_leads": cold,
        "interested_leads": interested,
        "avg_duration": _format_duration(int(avg_dur)),
        "conversion_rate": conversion_rate,
    }


# ─── Analytics trend ─────────────────────────────────────────────────────────

@router.get("/api/analytics/trend")
async def get_analytics_trend(
    institute_id: Optional[int] = Query(None),
    days: int = Query(default=7, le=30),
    session: AsyncSession = Depends(get_database),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    base_q = select(CallHistory).where(CallHistory.started_at >= cutoff)
    if institute_id:
        base_q = base_q.where(CallHistory.institute_id == institute_id)

    result = await session.execute(base_q)
    calls = result.scalars().all()

    # Group by date
    by_date: dict = {}
    for c in calls:
        day = c.started_at.strftime("%b %d") if c.started_at else "Unknown"
        if day not in by_date:
            by_date[day] = {"date": day, "calls": 0, "interested": 0, "hot": 0}
        by_date[day]["calls"] += 1

    # Enrich with report data
    for c in calls:
        rq = await session.execute(
            select(CallReport).where(CallReport.call_id == c.call_id)
        )
        rep = rq.scalar_one_or_none()
        if rep and c.started_at:
            day = c.started_at.strftime("%b %d")
            score = rep.interest_score or 0
            if score >= 40:
                by_date[day]["interested"] = by_date[day].get("interested", 0) + 1
            if score >= 70:
                by_date[day]["hot"] = by_date[day].get("hot", 0) + 1

    # Sort by date
    trend = sorted(by_date.values(), key=lambda x: x["date"])
    return trend
