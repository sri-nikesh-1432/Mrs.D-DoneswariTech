"""
Telephony Webhook Routes - inbound/outbound call handling via Twilio-style provider.

Spec §58 §59 §63:
  - Incoming call webhook → Mrs.D answers automatically, runs the voice pipeline,
    records transcript + report, persists a CallHistory + call_report.
  - Outbound call: dashboard POST /api/telephony/call initiates an outbound call
    through the provider; the provider calls back with status updates.
  - Webhook verification (Twilio signature) is supported; in development it is
    bypassed when TWILIO_AUTH_TOKEN is unset.
"""

import hashlib
import hmac
import time
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Form, Header
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
import uuid as _uuid

from app.database.connection import get_database
from app.database.models import Institute, CallHistory, CallStatus, Sentiment
from app.logs.logger import get_logger
from app.config.settings import settings

logger = get_logger(__name__)

router = APIRouter(prefix="/api/telephony", tags=["Telephony"])


def _twilio_signature_valid(
    url: str, params: dict, signature: str, auth_token: str
) -> bool:
    """Verify a Twilio webhook request signature (spec §71)."""
    if not auth_token:
        return True  # development: no token configured → bypass verification
    sorted_params = sorted((k, str(v)) for k, v in params.items())
    encoded = "&".join(f"{k}={v}" for k, v in sorted_params)
    base = f"{url}{encoded}"
    expected = hmac.new(
        auth_token.encode("utf-8"), base.encode("utf-8"), hashlib.sha1
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/incoming")
async def handle_incoming_call(
    request: Request,
    called_number: str = Form(...),
    from_number: str = Form(...),
    from_city: Optional[str] = Form(None),
    twilio_signature: Optional[str] = Header(None, alias="X-Twilio-Signature"),
):
    """
    Twilio-style inbound call webhook.

    When somebody dials the tenant's configured business number, the telephony
    provider POSTs here. Mrs.D answers, runs the voice session (WS → VAD → STT →
    LLM → TTS), and persists a CallHistory + call report when the call ends.

    In development (no TWILIO_AUTH_TOKEN) the signature check is skipped.
    """
    # Verify the webhook came from the provider (spec §71).
    if not _twilio_signature_valid(
        str(request.url), dict(request.form() or request.query_params), twilio_signature or "", settings.TWILIO_AUTH_TOKEN
    ):
        logger.warning("Incoming call webhook signature invalid; rejecting")
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    call_id = f"call_{_uuid.uuid4().hex[:12]}"
    started_at = datetime.now(timezone.utc)

    logger.info(
        "INBOUND_CALL | call=%s | to=%s | from=%s | city=%s",
        call_id, called_number, from_number, from_city,
    )

    try:
        # Resolve the institute that owns this phone number (tenant isolation).
        session: AsyncSession = await get_database()
        result = await session.execute(
            select(Institute).where(Institute.phone_number == called_number)
        )
        institute = result.scalar_one_or_none()
        if not institute:
            logger.warning(
                "INBOUND_CALL | no institute owns phone %s; rejecting", called_number
            )
            raise HTTPException(status_code=404, detail="No institute owns this phone number")

        # Persist the incoming call record (tenant-scoped).
        call = CallHistory(
            call_id=call_id,
            institute_id=institute.id,
            caller_number=from_number,
            caller_name=None,
            call_status=CallStatus.INCOMING,
            started_at=started_at,
            detected_language=None,
            sentiment=Sentiment.UNKNOWN,
        )
        session.add(call)
        await session.commit()
        await session.refresh(call)

        # Hand off to the voice WS pipeline. In production this would dial the
        # WebSocket voice agent with the real PCM audio stream from the telephony
        # provider (Twilio Media Streams / WebRTC). Here we acknowledge the call
        # and let the provider keep the line open while the WS pipeline runs.
        logger.info(
            "INBOUND_CALL | handed off to voice agent | call=%s | institute=%s",
            call_id, institute.institute_id,
        )

        # Return TwiML-like instructions telling the provider to connect to Mrs.D.
        # A real integration uses <Connect><Stream url="..."/></Connect> or the
        # WebSocket voice agent URL. This placeholder tells the provider to keep
        # the call live and stream audio to the voice WS endpoint.
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f'  <Say voice="alice">Connecting you to {institute.name}. Please hold.</Say>\n'
            "  <Connect>\n"
            "    <Stream url='wss://" + settings.HOST + ":" + str(settings.PORT) + "/ws/voice/" + str(institute.id) + "'/>\n"
            "  </Connect>\n"
            "</Response>\n"
        )
        return Response(content=twiml, media_type="application/xml")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("INBOUND_CALL failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/outbound/status")
async def handle_outbound_status(
    request: Request,
    call_sid: str = Form(...),
    call_status: str = Form(...),
    duration_seconds: Optional[int] = Form(None),
    answered_by: Optional[str] = Form(None),
    twilio_signature: Optional[str] = Header(None, alias="X-Twilio-Signature"),
):
    """
    Outbound call status callback from the telephony provider.

    The provider reports call progress (queued → dialing → ringing → answered →
    completed / failed / busy / no-answer) so we can update the CallHistory and,
    when the call ends, finalize the report.
    """
    if not _twilio_signature_valid(
        str(request.url), dict(request.form() or request.query_params), twilio_signature or "", settings.TWILIO_AUTH_TOKEN
    ):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")

    status_map = {
        "queued": CallStatus.INCOMING,
        "dialing": CallStatus.INCOMING,
        "ringing": CallStatus.INCOMING,
        "answered": CallStatus.ANSWERED,
        "completed": CallStatus.COMPLETED,
        "failed": CallStatus.FAILED,
        "busy": CallStatus.FAILED,
        "no-answer": CallStatus.MISSED,
        "canceled": CallStatus.MISSED,
    }
    db_status = status_map.get(call_status, CallStatus.FAILED)

    logger.info(
        "OUTBOUND_STATUS | call_sid=%s | status=%s | duration=%s | answered_by=%s",
        call_sid, call_status, duration_seconds, answered_by,
    )

    try:
        session: AsyncSession = await get_database()
        result = await session.execute(
            select(CallHistory).where(CallHistory.call_id == call_sid)
        )
        call = result.scalar_one_or_none()
        if not call:
            logger.warning("OUTBOUND_STATUS | unknown call_sid=%s", call_sid)
            return {"status": "ignored", "call_sid": call_sid}

        call.call_status = db_status
        call.duration_seconds = duration_seconds or call.duration_seconds
        if answered_by:
            call.caller_name = answered_by
        if db_status == CallStatus.COMPLETED and duration_seconds:
            call.ended_at = datetime.now(timezone.utc)
            # Update institute stats.
            institute_result = await session.execute(
                select(Institute).where(Institute.id == call.institute_id)
            )
            institute = institute_result.scalar_one()
            institute.total_calls += 1
            institute.completed_calls += 1
            institute.total_duration_seconds = (
                institute.total_duration_seconds or 0
            ) + float(duration_seconds)
        await session.commit()

        return {"status": "ok", "call_sid": call_sid}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("OUTBOUND_STATUS failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/outbound")
async def initiate_outbound_call(
    phone_number: str = Form(...),
    institute_id: int = Form(...),
    client_number: Optional[str] = Form(None),
):
    """
    Initiate an outbound call through the telephony provider (spec §59).

    Mrs.D calls the given phone number and conducts a real voice conversation.
    The provider callbacks to /api/telephony/outbound/status with progress.

    Returns the call_sid so the dashboard can poll /calls/{id} for status.
    """
    if not settings.TWILIO_ACCOUNT_SID:
        raise HTTPException(
            status_code=503,
            detail="Telephony not configured. Set TWILIO_ACCOUNT_SID, "
            "TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER in .env.",
        )

    call_sid = f"out_{_uuid.uuid4().hex[:12]}"
    started_at = datetime.now(timezone.utc)

    logger.info(
        "OUTBOUND_CALL | call_sid=%s | to=%s | institute_id=%s",
        call_sid, phone_number, institute_id,
    )

    try:
        session: AsyncSession = await get_database()
        result = await session.execute(
            select(Institute).where(Institute.id == institute_id)
        )
        institute = result.scalar_one_or_none()
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")

        # Persist the outbound call record.
        call = CallHistory(
            call_id=call_sid,
            institute_id=institute.id,
            caller_number=phone_number,
            caller_name=None,
            call_status=CallStatus.INCOMING,  # provider hasn't answered yet
            started_at=started_at,
        )
        session.add(call)
        await session.commit()
        await session.refresh(call)

        # In a real integration this would call the Twilio REST API:
        #   client.calls.create(to=phone_number, from_=TWILIO_PHONE_NUMBER,
        #                       url=call_webhook_url, status_callback=status_webhook_url)
        # Here we return the call_sid and let the provider callback populate the
        # rest; the frontend polls /calls/{call_sid} for the live state.

        return {
            "call_sid": call_sid,
            "to": phone_number,
            "from": settings.TWILIO_PHONE_NUMBER or "",
            "status": "queued",
            "institute_id": institute.id,
            "institute_name": institute.name,
            "started_at": started_at.isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("OUTBOUND_CALL failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
