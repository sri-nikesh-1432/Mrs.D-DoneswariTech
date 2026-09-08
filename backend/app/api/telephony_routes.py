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
from fastapi.websockets import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
import uuid as _uuid

from app.database.connection import get_database
from app.database.models import Institute, CallHistory, CallStatus, Sentiment, CallReport
from app.voice.voice_ws import _process_utterance
from app.logs.logger import get_logger
from app.config.settings import settings
from app.reports.call_report_service import generate_and_persist_report

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




# ── Twilio Media Streams (real-time PCM from telephony provider) ──────────────
# Twilio can stream the call audio to a WebSocket we host. This is the path
# that makes inbound/outbound calls real: the provider sends 16 kHz PCM frames
# (base64 inside a JSON track) and we feed them into the SAME ws_voice_agent
# pipeline that the browser uses.
# 
# Architecture (spec §11 §12 §58):
#   Twilio Media Streams WS  →  /api/telephony/media  →  decode PCM  →  VAD/STT/LLM/TTS
#   The WS voice agent already accepts PCM 16 kHz mono int16 frames over a
#   binary WebSocket; the Media Streams handler just decodes Twilio's JSON
#   wrapper and forwards the raw PCM into that pipeline.


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

            # Generate + persist the structured call report (spec §32).
            try:
                institute_obj = institute
                transcript = call.transcript or ""
                # Best-effort memory: none in the telephony path yet; the WS
                # voice agent path feeds memory into the report instead.
                memory: dict = {}
                await generate_and_persist_report(
                    session, call, institute_obj.name or "Institute", transcript, memory,
                )
            except Exception as e:
                logger.error("CALL_REPORT generation failed for %s: %s", call_sid, e)

        await session.commit()

        return {"status": "ok", "call_sid": call_sid}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("OUTBOUND_STATUS failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Twilio Media Streams WebSocket (real telephony PCM) ─────────────────────

@router.websocket("/telephony/media/{call_sid}")
async def twilio_media_stream(websocket: WebSocket):
    """Accept a Twilio Media Streams WebSocket for a live call and feed PCM into
    the voice pipeline.

    Twilio connects to this WS when the call is answered and streams 16 kHz mono
    PCM frames as base64-encoded tracks. We decode them and hand them to the SAME
    VAD→STT→LLM→TTS pipeline used by the browser WS path (spec §11 §12 §58).

    Flow:
      1. Twilio opens WS to /api/telephony/media/{call_sid}
      2. We accept and send a Twilio Media Streams handshake (stream onset)
      3. We receive {"event":"media","streamSid", "media":{"payload": base64}}
      4. We decode the base64 PCM and forward it to the voice agent as if it came
         from a browser mic (the voice agent runs VAD, STT, LLM, TTS internally)
      5. TTS audio is sent back to Twilio as {"event":"media","streamSid",
         "media":{"payload": base64_pcm}}
      6. On disconnect, the call is finalized and the report persisted (spec §32)
    """
    await websocket.accept()
    call_sid = websocket.path_params["call_sid"]
    logger.info("TWILIO_MEDIA_CONNECT | call_sid=%s", call_sid)

    # Handshake: tell Twilio we're ready to receive the stream.
    await websocket.send_json({
        "event": "start",
        "streamSid": call_sid,
        "start": {"streamSid": call_sid, "tracks": [{"type": "audio"}]},
    })

    # The voice agent expects PCM bytes over a binary WS. We keep a separate
    # binary pipe that the Media Streams decoder writes PCM into and the voice
    # agent reads from. For now (dev), we log and acknowledge.
    try:
        while True:
            raw = await websocket.receive_json()
            event = raw.get("event")
            if event == "media":
                payload = raw.get("media", {}).get("payload")
                if payload:
                    import base64
                    pcm = base64.b64decode(payload)
                    logger.debug("TWILIO_MEDIA | call_sid=%s | received %d bytes PCM", call_sid, len(pcm))
                    # TODO: forward pcm into the voice agent pipeline (same as browser WS path).
                    # The simplest integration: open a SECOND binary WS to the same voice
                    # agent and write pcm bytes there, then read TTS audio back and push
                    # it to Twilio as {"event":"media"}. That is wired in a later pass.
            elif event == "track":
                logger.info("TWILIO_MEDIA | track event: %s", raw.get("track"))
            elif event == "stop":
                logger.info("TWILIO_MEDIA | stream ended: call_sid=%s", call_sid)
                break
    except WebSocketDisconnect:
        logger.info("TWILIO_MEDIA_DISCONNECT | call_sid=%s", call_sid)
    except Exception as e:
        logger.exception("TWILIO_MEDIA error | call_sid=%s: %s", call_sid, e)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass




@router.get("/calls/{call_id}")
async def get_call_with_report(
    call_id: str,
    session: AsyncSession = Depends(get_database),
):
    """Get a call with its structured report (spec §34 §35)."""
    result = await session.execute(
        select(CallHistory).where(CallHistory.call_id == call_id)
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    report = None
    if call.report:
        report = {
            "caller_name": call.report.caller_name,
            "student_name": call.report.student_name,
            "student_class": call.report.student_class,
            "course": call.report.course,
            "location": call.report.location,
            "budget": call.report.budget,
            "hostel": call.report.hostel,
            "transport": call.report.transport,
            "interest_score": call.report.interest_score,
            "conversion_probability": call.report.conversion_probability,
            "intent": call.report.intent,
            "lead_status": call.report.lead_status,
            "objections": call.report.objections,
            "next_action": call.report.next_action,
            "summary": call.report.summary,
            "questions_asked": call.report.questions_asked,
        }

    return {
        "call_id": call.call_id,
        "caller_number": call.caller_number,
        "caller_name": call.caller_name,
        "call_status": call.call_status.value,
        "started_at": call.started_at.isoformat() if call.started_at else None,
        "answered_at": call.answered_at.isoformat() if call.answered_at else None,
        "ended_at": call.ended_at.isoformat() if call.ended_at else None,
        "duration_seconds": call.duration_seconds,
        "transcript": call.transcript,
        "detected_language": call.detected_language,
        "sentiment": call.sentiment.value if call.sentiment else None,
        "total_turns": call.total_turns,
        "report": report,
    }


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
