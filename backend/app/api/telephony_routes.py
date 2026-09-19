"""
Telephony Webhook & Outbound Call Routes (spec §31-§35 §50 §63).

REAL telephony flow:
  1. POST /api/agents/{id}/test-call          → validate + create REAL Twilio call
  2. GET  /api/telephony/outbound/twiml/{id}  → TwiML that connects live audio
                                                 to our media-stream WS
  3. WS   /api/telephony/media/{call_id}      → bidirectional phone audio
  4. POST /api/telephony/outbound/status      → provider status callbacks update
                                                 the REAL call state
  5. POST /api/telephony/incoming             → inbound calls answered by the agent

Webhook signature verification is enforced whenever TWILIO_AUTH_TOKEN is set
(spec §50); unauthenticated requests can never mark a call completed.
"""

import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Form, Header
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import Institute, Student, CallHistory, CallEvent, AgentStatus
from app.config.settings import settings
from app.logs.logger import get_logger
from app.telephony.twilio_service import twilio_service, validate_phone_number

logger = get_logger(__name__)

# Telephony-provider routes (webhooks, TwiML, media) under /api/telephony.
router = APIRouter(prefix="/api/telephony", tags=["Telephony"])

# Agent-scoped telephony routes (test call) mounted WITHOUT the prefix so
# they live at the canonical /api/agents/{id}/test-call paths (spec §52).
agent_telephony_router = APIRouter(tags=["Telephony"])


# ── Webhook signature verification (spec §50) ─────────────────────────────────

async def _twilio_signature_valid(request: Request, signature: Optional[str]) -> bool:
    """
    Verify the X-Twilio-Signature header per Twilio's algorithm:
    HMAC-SHA1 over URL + sorted POST params using the auth token.
    In development (token unset) verification is bypassed — production MUST
    set TWILIO_AUTH_TOKEN.
    """
    if not settings.TWILIO_AUTH_TOKEN:
        return True  # dev mode: no token configured
    if not signature:
        return False
    try:
        form = await request.form()
        params = {k: str(v) for k, v in form.items()}
    except Exception:
        params = dict(request.query_params)
    sorted_params = "".join(f"{k}{v}" for k, v in sorted(params.items()))
    base = str(request.url) + sorted_params
    expected = hmac.new(
        settings.TWILIO_AUTH_TOKEN.encode("utf-8"),
        base.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    import base64 as _b64
    expected_b64 = _b64.b64encode(expected).decode("utf-8")
    return hmac.compare_digest(expected_b64, signature)


# ── TwiML for outbound calls ──────────────────────────────────────────────────

@router.get("/outbound/twiml/{call_id}")
async def outbound_twiml(call_id: str, agent_id: int = 1):
    """
    Twilio requests this URL when the student ANSWERS the outbound call.
    Returns TwiML that bridges the live call to our real-time voice agent
    media stream (the same runtime as the browser preview — spec §16 §57).
    """
    twiml = twilio_service.build_outbound_twiml(agent_id, call_id)
    logger.info("TWIML_REQUEST | call=%s agent=%d", call_id, agent_id)
    return Response(content=twiml, media_type="application/xml")


# ── Provider status callbacks (spec §34 §63) ──────────────────────────────────

@router.post("/outbound/status")
async def handle_outbound_status(request: Request):
    """
    REAL provider status callback. The call state machine lives here:
    queued → ringing → in-progress → completed / busy / no-answer / failed.
    The frontend NEVER invents these states (spec §34 §53).
    """
    sig = request.headers.get("X-Twilio-Signature")
    if not await _twilio_signature_valid(request, sig):
        logger.warning("Outbound status webhook: invalid signature; rejecting")
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        form = await request.form()
        call_sid = str(form.get("CallSid", ""))
        call_status = str(form.get("CallStatus", ""))
        duration = str(form.get("CallDuration", "") or "")
        from_number = str(form.get("From", ""))
    except Exception:
        call_sid = request.query_params.get("CallSid", "")
        call_status = request.query_params.get("CallStatus", "")
        duration = ""
        from_number = ""

    if not call_sid:
        return {"status": "ignored"}

    # Twilio status → internal call state machine (spec §34).
    status_map = {
        "queued": "Calling",
        "initiating": "Calling",
        "ringing": "Ringing",
        "in-progress": "In Progress",
        "answered": "In Progress",
        "completed": "Completed",
        "busy": "Busy",
        "failed": "Failed",
        "no-answer": "No Answer",
        "canceled": "Cancelled",
    }
    db_status = status_map.get(call_status, "Failed")
    duration_seconds = int(duration) if duration.isdigit() else None

    logger.info(
        "OUTBOUND_STATUS | sid=%s | status=%s | mapped=%s | duration=%s",
        call_sid, call_status, db_status, duration or "-",
    )

    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(CallHistory).where(CallHistory.provider_call_id == call_sid)
        )
        call = res.scalar_one_or_none()
        if not call:
            logger.warning("OUTBOUND_STATUS | unknown provider call sid=%s", call_sid)
            return {"status": "ignored", "call_sid": call_sid}

        now = datetime.now(timezone.utc)
        call.call_status = db_status
        if db_status in ("Busy", "No Answer", "Failed", "Cancelled"):
            call.ended_at = now
            if duration_seconds:
                call.duration_seconds = duration_seconds

        if duration_seconds and db_status == "Completed":
            call.duration_seconds = duration_seconds

        session.add(CallEvent(
            call_id=call.call_id,
            event_type=call_status or "unknown",
            source="provider",
            provider_call_id=call_sid,
            detail={"mapped_status": db_status, "duration": duration or None},
        ))

        # Keep the student's call status in sync with REAL provider events.
        if call.student_id:
            student = await session.get(Student, call.student_id)
            if student:
                if db_status in ("Busy", "No Answer", "Failed", "Cancelled", "Completed", "In Progress"):
                    student.call_status = db_status

        await session.commit()
        call_id = call.call_id

    return {"status": "ok", "call_id": call_id, "call_status": db_status}


# ── Inbound calls (spec §63) ──────────────────────────────────────────────────

@router.post("/incoming")
async def handle_incoming_call(request: Request):
    """
    Inbound call webhook: when someone dials the agent's configured business
    number, answer with the agent's real-time voice pipeline.
    """
    sig = request.headers.get("X-Twilio-Signature")
    if not await _twilio_signature_valid(request, sig):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    try:
        form = await request.form()
        called_number = str(form.get("To", ""))
        from_number = str(form.get("From", ""))
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed webhook")

    call_id = f"in_{uuid.uuid4().hex[:12]}"
    logger.info("INBOUND_CALL | call=%s | to=%s | from=%s", call_id, called_number, from_number)

    async with AsyncSessionLocal() as session:
        # Tenant isolation: the inbound number must belong to a configured agent.
        res = await session.execute(
            select(Institute).where(Institute.phone_number == called_number)
        )
        agent = res.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="No agent owns this phone number")

        if agent.status not in (AgentStatus.PUBLISHED.value, AgentStatus.READY.value):
            raise HTTPException(status_code=400, detail="Agent is not accepting calls")

        call = CallHistory(
            call_id=call_id,
            institute_id=agent.id,
            caller_number=from_number,
            call_status="Ringing",
            started_at=datetime.now(timezone.utc),
            provider="twilio",
            provider_call_id=str(form.get("CallSid", "")),
            direction="inbound",
        )
        session.add(call)
        session.add(CallEvent(call_id=call_id, event_type="ringing", source="provider"))
        await session.commit()

    twiml = twilio_service.build_outbound_twiml(agent.id, call_id)
    return Response(content=twiml, media_type="application/xml")


# ── Call detail with real transcript + events (spec §36 §38 §63) ─────────────

@router.get("/calls/{call_id}")
async def get_call_detail(call_id: str, session: AsyncSession = Depends(get_database)):
    """Full real call detail: transcript messages, events, analysis, latency."""
    from app.database.models import TranscriptMessage, CallReport

    res = await session.execute(select(CallHistory).where(CallHistory.call_id == call_id))
    call = res.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    msgs_res = await session.execute(
        select(TranscriptMessage)
        .where(TranscriptMessage.call_id == call_id)
        .order_by(TranscriptMessage.id.asc())
    )
    messages = [
        {
            "sequence": m.sequence,
            "speaker": m.speaker,
            "text": m.text,
            "language": m.language,
            "latency_ms": m.latency_ms,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
        }
        for m in msgs_res.scalars().all()
    ]

    events_res = await session.execute(
        select(CallEvent)
        .where(CallEvent.call_id == call_id)
        .order_by(CallEvent.id.asc())
    )
    events = [
        {
            "event_type": e.event_type,
            "source": e.source,
            "provider_call_id": e.provider_call_id,
            "detail": e.detail,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events_res.scalars().all()
    ]

    report = None
    if call.report:
        report = {
            "interest_score": call.report.interest_score,
            "conversion_probability": call.report.conversion_probability,
            "intent": call.report.intent,
            "lead_status": call.report.lead_status,
            "summary": call.report.summary,
            "next_action": call.report.next_action,
        }

    return {
        "call_id": call.call_id,
        "caller_number": call.caller_number,
        "caller_name": call.caller_name,
        "call_status": call.call_status,
        "provider": call.provider,
        "provider_call_id": call.provider_call_id,
        "direction": call.direction,
        "started_at": call.started_at.isoformat() if call.started_at else None,
        "answered_at": call.answered_at.isoformat() if call.answered_at else None,
        "ended_at": call.ended_at.isoformat() if call.ended_at else None,
        "duration_seconds": call.duration_seconds,
        "interest_level": call.interest_level,
        "outcome": call.outcome,
        "transcript_messages": messages,
        "events": events,
        "report": report,
    }


# ── Agent-scoped telephony endpoints ─────────────────────────────────────────

class TestCallRequest(BaseModel):
    phone_number: str


@agent_telephony_router.post("/api/agents/{agent_id}/test-call")
async def agent_test_call(
    agent_id: int,
    body: TestCallRequest,
    session: AsyncSession = Depends(get_database),
):
    """
    TEST CALL (spec §33): dial a real phone number now.
      1. Validate the number (libphonenumber).
      2. Validate agent is READY/PUBLISHED.
      3. Validate telephony configuration.
      4. Create the REAL outbound call — the user's actual phone rings.
    """
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.status not in (AgentStatus.PUBLISHED.value, AgentStatus.READY.value):
        raise HTTPException(
            status_code=400,
            detail=f"Agent must be READY or PUBLISHED before test calls (current status: {agent.status}). "
                   "Save changes and process knowledge first.",
        )

    if not twilio_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=twilio_service.configuration_error()
            + " Real phone calls cannot be simulated.",
        )

    validation = validate_phone_number(body.phone_number)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail=validation["error"])

    call_id = f"test_{uuid.uuid4().hex[:12]}"
    call = CallHistory(
        call_id=call_id,
        institute_id=agent.id,
        caller_number=validation["e164"],
        caller_name="Test Call",
        call_status="Calling",
        started_at=datetime.now(timezone.utc),
        provider="twilio",
        direction="outbound",
    )
    session.add(call)
    session.add(CallEvent(call_id=call_id, event_type="queued", source="system", detail={"test_call": True}))
    await session.commit()

    try:
        result = await twilio_service.create_outbound_call(
            to_number=validation["e164"],
            agent_id=agent.id,
            call_id=call_id,
        )
    except Exception as e:
        async with AsyncSessionLocal() as s2:
            res = await s2.execute(select(CallHistory).where(CallHistory.call_id == call_id))
            c = res.scalar_one_or_none()
            if c:
                c.call_status = "Failed"
                c.error_message = str(e)[:500]
                s2.add(CallEvent(call_id=call_id, event_type="failed", source="provider", detail={"error": str(e)[:300]}))
            await s2.commit()
        raise HTTPException(status_code=502, detail=f"Telephony provider error: {e}")

    async with AsyncSessionLocal() as s2:
        res = await s2.execute(select(CallHistory).where(CallHistory.call_id == call_id))
        c = res.scalar_one_or_none()
        if c:
            c.provider_call_id = result["provider_call_id"]
            s2.add(CallEvent(
                call_id=call_id, event_type="initiating", source="provider",
                provider_call_id=result["provider_call_id"],
            ))
            await s2.commit()

    logger.info("TEST_CALL | call=%s sid=%s to=%s agent=%d", call_id, result["provider_call_id"], validation["e164"], agent.id)

    return {
        "call_id": call_id,
        "provider_call_id": result["provider_call_id"],
        "to": validation["e164"],
        "to_national": validation["national"],
        "status": result["status"],
        "message": f"Real call placed to {validation['national']} — your phone should ring now.",
    }


@agent_telephony_router.get("/api/agents/{agent_id}/test-call/{call_id}")
async def agent_test_call_status(agent_id: int, call_id: str):
    """
    Live status for a test call — read from the REAL provider so the UI
    shows ringing/answered/completed exactly as the provider reports.
    """
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            select(CallHistory).where(
                CallHistory.call_id == call_id, CallHistory.institute_id == agent_id
            )
        )
        call = res.scalar_one_or_none()
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")

        events_res = await session.execute(
            select(CallEvent).where(CallEvent.call_id == call_id).order_by(CallEvent.id.asc())
        )
        events = [
            {"event_type": e.event_type, "source": e.source, "created_at": e.created_at.isoformat() if e.created_at else None}
            for e in events_res.scalars().all()
        ]

        # Prefer LIVE provider status when available (spec §34 §63).
        provider_status = None
        if call.provider_call_id and twilio_service.is_configured():
            try:
                import asyncio
                live = await asyncio.get_event_loop().run_in_executor(
                    None, twilio_service.fetch_call_status, call.provider_call_id
                )
                provider_status = live.get("status")
            except Exception as e:
                logger.debug("Live provider status fetch failed: %s", e)

    return {
        "call_id": call.call_id,
        "call_status": call.call_status,
        "provider_status": provider_status,
        "provider_call_id": call.provider_call_id,
        "duration_seconds": call.duration_seconds,
        "events": events,
    }
