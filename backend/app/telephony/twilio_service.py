"""
Real Twilio Telephony Service (spec §31-§35, §50).

This module performs REAL telephony — no simulations:
  • create_outbound_call()   → Twilio REST API creates a real phone call to
                               the student's actual number.
  • The call's TwiML <Connect><Stream> bridges the live phone audio to our
    /api/telephony/media/{call_id} WebSocket, where the SAME voice-agent
    runtime used by the browser preview (VAD → STT → RAG → LLM → TTS)
    conducts the conversation.
  • build_outbound_twiml()   → TwiML instructing Twilio to open the media
    stream against the deployed public backend URL.
  • Phone validation via the `phonenumbers` library (spec §31 §49).

Configuration (environment variables, spec §65):
  TWILIO_ACCOUNT_SID   — Twilio account SID
  TWILIO_AUTH_TOKEN    — Twilio auth token
  TWILIO_PHONE_NUMBER  — the caller-ID number students will see
  PUBLIC_BASE_URL      — public HTTPS origin Twilio can reach (for webhooks);
                         e.g. https://abc123.ngrok-free.app
"""

import os
from typing import Optional, Dict, Any
from urllib.parse import quote

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


def validate_phone_number(raw: str, default_region: str = "IN") -> Dict[str, Any]:
    """
    Validate and normalize a phone number using Google's libphonenumber
    (spec §31 §49). Returns {valid, e164, national, error}.
    """
    import phonenumbers
    from phonenumbers import NumberParseException, PhoneNumberFormat

    if not raw or not str(raw).strip():
        return {"valid": False, "error": "Phone number is required"}
    try:
        parsed = phonenumbers.parse(str(raw).strip(), default_region)
        if not phonenumbers.is_valid_number(parsed):
            return {"valid": False, "error": f"'{raw}' is not a valid phone number"}
        return {
            "valid": True,
            "e164": phonenumbers.format_number(parsed, PhoneNumberFormat.E164),
            "national": phonenumbers.format_number(parsed, PhoneNumberFormat.NATIONAL),
        }
    except NumberParseException as e:
        return {"valid": False, "error": f"Invalid phone number '{raw}': {e}"}


class TwilioService:
    """Real outbound calling + TwiML generation via the Twilio REST API."""

    def __init__(self):
        self._client = None

    def is_configured(self) -> bool:
        """True when real telephony credentials are present (spec §54)."""
        return bool(
            settings.TWILIO_ACCOUNT_SID
            and settings.TWILIO_AUTH_TOKEN
            and settings.TWILIO_PHONE_NUMBER
        )

    def configuration_error(self) -> str:
        """Human-readable configuration error (spec §54)."""
        missing = []
        if not settings.TWILIO_ACCOUNT_SID:
            missing.append("TWILIO_ACCOUNT_SID")
        if not settings.TWILIO_AUTH_TOKEN:
            missing.append("TWILIO_AUTH_TOKEN")
        if not settings.TWILIO_PHONE_NUMBER:
            missing.append("TWILIO_PHONE_NUMBER")
        if missing:
            return f"Telephony credentials missing: {', '.join(missing)}. Set them in backend/.env to enable real phone calls."
        return ""

    def _get_client(self):
        """Lazy-init the Twilio REST client with real credentials."""
        if self._client is None:
            if not self.is_configured():
                raise RuntimeError(self.configuration_error())
            from twilio.rest import Client
            self._client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        return self._client

    def _public_base_url(self) -> str:
        """Public HTTPS base URL that Twilio's servers can reach (spec §66)."""
        return (
            os.getenv("PUBLIC_BASE_URL")
            or f"https://{settings.HOST}:{settings.PORT}"
        )

    def build_outbound_twiml(self, agent_id: int, call_id: str) -> str:
        """
        TwiML that bridges the answered call to our real-time voice agent
        via Twilio Media Streams (bidirectional audio, spec §31-§32 §58).

        The media stream WebSocket URL points at the deployed backend so the
        live phone audio flows into the SAME pipeline as browser preview.
        """
        base = self._public_base_url().replace("https://", "").replace("http://", "")
        ws_scheme = "wss"
        stream_url = f"{ws_scheme}://{base}/api/telephony/media/{quote(call_id)}?agent_id={agent_id}"
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f'  <Connect>\n    <Stream url="{stream_url}" track="inbound" />\n  </Connect>\n'
            "</Response>"
        )

    async def create_outbound_call(
        self,
        to_number: str,
        agent_id: int,
        call_id: str,
        student_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a REAL outbound phone call (spec §31 §33):
          1. Twilio dials the student's actual phone number.
          2. When answered, Twilio requests TwiML from our webhook.
          3. TwiML connects the live audio to our voice-agent media stream.
          4. Status callbacks report real ringing/answered/completed states.

        Runs the blocking Twilio REST call in a thread executor so the
        event loop is never blocked mid-call.

        Returns {provider_call_id, status} of the REAL created call.
        """
        import asyncio

        validation = validate_phone_number(to_number)
        if not validation["valid"]:
            raise ValueError(validation["error"])

        client = self._get_client()
        base_url = self._public_base_url()
        twiml_url = f"{base_url}/api/telephony/outbound/twiml/{quote(call_id)}"
        status_url = f"{base_url}/api/telephony/outbound/status"

        # Twilio REST API is synchronous — offload to a worker thread.
        def _create():
            return client.calls.create(
                to=validation["e164"],
                from_=settings.TWILIO_PHONE_NUMBER,
                url=twiml_url,
                status_callback=status_url,
                status_callback_event=["queued", "ringing", "answered", "completed"],
                method="GET",
                status_callback_method="POST",
                timeout=30,
            )

        try:
            loop = asyncio.get_event_loop()
            call = await loop.run_in_executor(None, _create)
        except Exception as e:
            logger.error("Twilio outbound call failed for %s: %s", validation["e164"], e)
            raise

        logger.info(
            "REAL outbound call created: call_id=%s twilio_sid=%s to=%s agent=%d",
            call_id, call.sid, validation["e164"], agent_id,
        )
        return {"provider_call_id": call.sid, "status": call.status, "to": validation["e164"]}

    def fetch_call_status(self, provider_call_id: str) -> Dict[str, Any]:
        """Fetch the live status of a call directly from Twilio (spec §34)."""
        client = self._get_client()
        call = client.calls(provider_call_id).fetch()
        return {
            "provider_call_id": call.sid,
            "status": call.status,
            "duration": int(call.duration or 0),
            "direction": call.direction,
            "answered_by": getattr(call, "answered_by", None),
        }


twilio_service = TwilioService()
