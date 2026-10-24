"""Dynamic TTS service router.

Routes TTS synthesis to either Edge-TTS or ElevenLabs based on the agent's
configured voice. The `get_tts_service()` factory already returns ElevenLabs
when `ELEVENLABS_API_KEY` is set; this module adds agent-aware routing so a
tenant that configures an ElevenLabs voice id gets ElevenLabs voice even when
the global ElevenLabs key is unset (the key may be set per agent in Redis/
shared config).

The global `get_tts_service()` remains the default for telephony and the
WebSocket pipeline; `DynamicTTSService` is used by the text/process endpoints
where an agent persona is available.
"""

from typing import Optional

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


async def get_tts_service():
    """Proxy that returns either an ElevenLabs service or an EdgeTTSService."""
    from app.tts.edge_tts_service import get_tts_service as get_edge_tts_service
    if settings.elevenlabs_enabled:
        try:
            from app.tts.elevenlabs_service import get_elevenlabs_service
            return get_elevenlabs_service()
        except Exception as e:
            logger.warning("ElevenLabs service init failed, falling back to EdgeTTS: %s", e)
    return get_edge_tts_service()


def _looks_like_elevenlabs_voice_id(voice: Optional[str]) -> bool:
    """True when the voice looks like an ElevenLabs voice id (no '-' or '.')."""
    if not voice:
        return False
    v = voice.strip()
    return 11 <= len(v) <= 30 and "-" not in v and "." not in v


class DynamicTTSService:
    """Dynamic TTS that selects the engine based on the agent's voice config."""

    def __init__(self):
        self._service = None  # initialized on first use

    def _get(self):
        if self._service is None:
            if settings.elevenlabs_enabled:
                try:
                    from app.tts.elevenlabs_service import get_elevenlabs_service
                    self._service = get_elevenlabs_service()
                except Exception:
                    pass
            if self._service is None:
                from app.tts.edge_tts_service import get_tts_service as get_edge_tts_service
                self._service = get_edge_tts_service()
        return self._service

    async def set_agent(self, persona: dict = None):
        """Switch the underlying TTS engine to match the agent's voice."""
        persona = persona or {}
        voice = persona.get("voice")
        if not voice:
            self._service = None
            return
        if _looks_like_elevenlabs_voice_id(voice) and settings.elevenlabs_enabled:
            try:
                from app.tts.elevenlabs_service import get_elevenlabs_service
                self._service = get_elevenlabs_service()
                logger.info("Dynamic TTS switched to ElevenLabs (agent voice=%s)", voice)
                return
            except Exception:
                pass
        from app.tts.edge_tts_service import get_tts_service as get_edge_tts_service
        self._service = get_edge_tts_service()

    async def synthesize(self, text: str, language: Optional[str] = None, voice=None, speed=None):
        service = self._get()
        if service is None:
            return None
        return await service.synthesize(text, language=language, voice=voice, speed=speed)

    async def synthesize_sentences(self, text: str, language=None, voice=None, speed=None):
        service = self._get()
        if service is None:
            return []
        return await service.synthesize_sentences(text, language=language, voice=voice, speed=speed)

    async def stream_sentences(self, text: str, language=None, voice=None, speed=None):
        service = self._get()
        if service is None:
            return
        async for chunk in service.stream_sentences(text, language=language, voice=voice, speed=speed):
            yield chunk

    async def initialize(self):
        service = self._get()
        if service is not None:
            await service.initialize()


