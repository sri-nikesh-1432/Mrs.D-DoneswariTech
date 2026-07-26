"""
Speech-to-Text Service
Uses Groq Whisper Large V3 Turbo.
Language is NOT hardcoded — Whisper auto-detects Telugu, Hindi, Tamil, English, etc.
Returns both the transcript text and the detected language code.
"""

import io
from groq import AsyncGroq
from utils.config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

_client: AsyncGroq | None = None


def _get_client() -> AsyncGroq:
    global _client
    if _client is None:
        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set in .env")
        _client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    return _client


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """
    Transcribe audio using Whisper Large V3 Turbo.
    Language is auto-detected by Whisper (no hardcoded language).
    Returns dict: { "text": str, "language": str }
    """
    if not audio_bytes:
        raise ValueError("Empty audio data received")

    client = _get_client()
    audio_file = (filename, io.BytesIO(audio_bytes), _get_mime_type(filename))

    try:
        transcription = await client.audio.transcriptions.create(
            model=settings.GROQ_STT_MODEL,
            file=audio_file,
            # No language= param → Whisper auto-detects
            response_format="verbose_json",  # gives us language field
        )

        text = transcription.text.strip() if hasattr(transcription, "text") else str(transcription).strip()
        # Whisper returns ISO 639-1 language code e.g. "te", "hi", "ta", "en"
        detected_lang = getattr(transcription, "language", "en") or "en"

        logger.info("STT | lang=%s | '%s...'", detected_lang, text[:60])
        return {"text": text, "language": detected_lang}

    except Exception as e:
        logger.error("STT transcription failed: %s", e)
        raise


def _get_mime_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    return {
        "webm": "audio/webm", "mp3": "audio/mpeg",
        "wav": "audio/wav",   "m4a": "audio/mp4",
        "ogg": "audio/ogg",   "flac": "audio/flac",
    }.get(ext, "audio/webm")
