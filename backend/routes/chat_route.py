"""
/chat route — Full Multilingual Voice Pipeline
Audio → Whisper STT (auto lang) → Memory → Groq LLM → Edge-TTS (matched voice) → Audio
"""

import time
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from memory.session_memory import get_or_create_session, add_turn, get_history
from services.stt_service import transcribe_audio
from services.llm_service import chat_completion
from services.tts_service import synthesize_speech
from services.language_service import detect_language
from utils.logger import get_logger, log_conversation

router = APIRouter()
logger = get_logger(__name__)


@router.post("/chat")
async def voice_chat(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
):
    """
    Full multilingual voice pipeline:
    1. Whisper STT — auto-detects language
    2. Groq LLM — replies in same language
    3. Edge-TTS — uses matched voice at 1.5x speed
    4. Returns MP3 + text headers
    """
    start_time = time.time()
    get_or_create_session(session_id)

    # ── Step 1: Speech-to-Text (auto language detection) ─────────────────────
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio too small or empty")

    try:
        stt_result = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except Exception as e:
        logger.error("STT failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Speech recognition failed: {str(e)}")

    transcript = stt_result["text"]
    # Use Whisper's detected language; fall back to Unicode detection
    lang = stt_result.get("language") or detect_language(transcript)

    if not transcript:
        raise HTTPException(status_code=422, detail="Could not understand the audio. Please speak clearly.")

    # ── Step 2: LLM Response ──────────────────────────────────────────────────
    history = get_history(session_id)
    try:
        answer = await chat_completion(history, transcript, lang=lang)
    except Exception as e:
        logger.error("LLM failed: %s", e)
        raise HTTPException(status_code=500, detail=f"AI response failed: {str(e)}")

    add_turn(session_id, transcript, answer)

    # ── Step 3: Text-to-Speech (language-matched voice, 1.5x speed) ──────────
    try:
        # Detect language of the answer (LLM may reply in same lang)
        answer_lang = detect_language(answer) if detect_language(answer) != "en" else lang
        audio_response = await synthesize_speech(answer, lang=answer_lang)
    except Exception as e:
        logger.error("TTS failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Speech synthesis failed: {str(e)}")

    duration_ms = (time.time() - start_time) * 1000
    log_conversation(session_id, transcript, answer, duration_ms, input_type="voice")
    logger.info("Voice chat | session=%s | lang=%s | %.0fms", session_id, lang, duration_ms)

    headers = {
        "X-Transcript":  transcript[:300],
        "X-Answer":      answer[:500],
        "X-Language":    lang,
        "X-Duration-Ms": str(round(duration_ms, 2)),
    }
    return Response(content=audio_response, media_type="audio/mpeg", headers=headers)
