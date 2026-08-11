"""
Text-to-Speech Service
Uses Microsoft Edge-TTS with automatic multilingual voice selection.
Speed: configurable via TTS_RATE (default +50% = 1.5x).
Voices: en-IN-NeerjaNeural / te-IN-ShrutiNeural / hi-IN-SwaraNeural / ta-IN-PallaviNeural

Audio files saved to static/audio/ are automatically cleaned up by the scheduler.
"""

import io
import os
import re
import time
import uuid

import edge_tts

from utils.config import settings
from utils.logger import get_logger
from services.language_service import detect_language, get_voice_for_language

logger = get_logger(__name__)

# Import the shared speech-normalization module so fees/numbers/abbreviations
# are spoken naturally, plus the TTS-input safety layer (clean_tts_text)
# that guarantees debug/telemetry text can NEVER reach the voice.
# The legacy pipeline reuses the same logic as Mrs. D.
try:
    from app.roman_telugu import normalize_for_speech as _normalize_for_speech
    from app.roman_telugu import clean_tts_text as _clean_tts_text
except Exception:
    def _normalize_for_speech(text: str) -> str:
        return text
    def _clean_tts_text(text) -> str:
        return text if isinstance(text, str) else ""

normalize_for_speech = _normalize_for_speech
clean_tts_text = _clean_tts_text


def _ensure_audio_dir() -> str:
    """Ensure the audio output directory exists and return its path."""
    os.makedirs(settings.AUDIO_DIR, exist_ok=True)
    return settings.AUDIO_DIR


async def synthesize_speech(text: str, lang: str | None = None) -> bytes:
    """
    Convert text to speech using Edge-TTS.
    Auto-selects the correct voice for the detected/provided language.
    Returns raw MP3 bytes (not saved to disk).
    """
    if not text or not text.strip():
        raise ValueError("Empty text provided for TTS synthesis")

    clean = _clean_for_speech(text)

    # Normalize fees/numbers/abbreviations so they are SPOKEN naturally
    # (ఒక లక్ష రూపాయలు, Two Thousand Twenty Six, ఎం పి సి) not digit-by-digit.
    # clean_tts_text() is the FINAL guard — debug/telemetry can never be read.
    clean = _clean_tts_text(normalize_for_speech(clean))
    if not clean:
        raise ValueError("TTS input empty after cleaning")

    if lang is None:
        lang = detect_language(clean)

    voice = get_voice_for_language(lang)
    rate  = settings.TTS_RATE

    logger.info(
        "TTS | lang=%s | voice=%s | rate=%s | %d chars",
        lang, voice, rate, len(clean),
    )

    try:
        communicate   = edge_tts.Communicate(clean, voice=voice, rate=rate)
        audio_buffer  = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])

        audio_bytes = audio_buffer.getvalue()
        if not audio_bytes:
            raise RuntimeError("Edge-TTS returned empty audio — check voice name and text")

        return audio_bytes

    except Exception as e:
        logger.error("TTS synthesis failed: %s", e)
        raise


async def synthesize_and_save(text: str, lang: str | None = None) -> str:
    """
    Synthesize speech and save the MP3 to static/audio/.
    Returns the relative URL path (e.g. /static/audio/<uuid>.mp3).
    The file will be cleaned up automatically by the scheduler.
    """
    audio_bytes = await synthesize_speech(text, lang)
    audio_dir   = _ensure_audio_dir()
    filename    = f"{uuid.uuid4().hex}.mp3"
    filepath    = os.path.join(audio_dir, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    logger.debug("TTS audio saved: %s", filepath)
    return f"/static/audio/{filename}"


def cleanup_old_audio_files() -> int:
    """
    Delete MP3 files in static/audio/ older than AUDIO_CLEANUP_MINUTES.
    Called automatically by the APScheduler background job.
    Returns the number of files deleted.
    """
    audio_dir = settings.AUDIO_DIR
    if not os.path.isdir(audio_dir):
        return 0

    cutoff    = time.time() - (settings.AUDIO_CLEANUP_MINUTES * 60)
    deleted   = 0

    for fname in os.listdir(audio_dir):
        if not fname.endswith(".mp3"):
            continue
        fpath = os.path.join(audio_dir, fname)
        try:
            if os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
                deleted += 1
        except OSError as e:
            logger.warning("Could not delete audio file %s: %s", fpath, e)

    if deleted:
        logger.info("Audio cleanup: deleted %d old MP3 file(s)", deleted)

    return deleted


def _clean_for_speech(text: str) -> str:
    """
    Strip markdown formatting and URLs that sound unnatural when spoken aloud.
    Preserves the actual content while removing visual-only markup.
    """
    # Remove bold/italic markdown
    text = re.sub(r"\*{1,3}(.*?)\*{1,3}", r"\1", text)
    # Remove markdown headers
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Remove bullet points
    text = re.sub(r"^\s*[-•*]\s+", "", text, flags=re.MULTILINE)
    # Remove URLs
    text = re.sub(r"https?://\S+", "", text)
    # Collapse newlines to spaces
    text = re.sub(r"\n+", " ", text)
    # Collapse multiple spaces
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()
