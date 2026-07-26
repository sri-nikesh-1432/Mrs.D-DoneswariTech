"""
/text-chat route — Multilingual Text Conversation Pipeline
Text → Language Detection → Memory → Groq LLM → Edge-TTS (matched voice) → JSON
"""

import time
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import TextChatRequest
from memory.session_memory import get_or_create_session, add_turn, get_history
from services.llm_service import chat_completion, chat_completion_stream
from services.tts_service import synthesize_and_save
from services.language_service import detect_language
from utils.logger import get_logger, log_conversation

router = APIRouter()
logger = get_logger(__name__)


@router.post("/text-chat")
async def text_chat(request: TextChatRequest):
    """
    Multilingual text pipeline:
    1. Detect language from user text
    2. LLM replies in same language
    3. TTS uses matched voice at 1.5x speed
    """
    start_time = time.time()
    get_or_create_session(request.session_id)

    # Detect language from user's message
    lang = detect_language(request.message)
    history = get_history(request.session_id)

    try:
        answer = await chat_completion(history, request.message, lang=lang)
    except Exception as e:
        logger.error("LLM failed in /text-chat: %s", e)
        raise HTTPException(status_code=500, detail=f"AI response failed: {str(e)}")

    add_turn(request.session_id, request.message, answer)

    audio_url = None
    if request.return_audio:
        try:
            answer_lang = detect_language(answer) if detect_language(answer) != "en" else lang
            audio_url = await synthesize_and_save(answer, lang=answer_lang)
        except Exception as e:
            logger.warning("TTS failed in /text-chat (non-fatal): %s", e)

    duration_ms = (time.time() - start_time) * 1000
    log_conversation(request.session_id, request.message, answer, duration_ms, input_type="text")
    logger.info("Text chat | session=%s | lang=%s | %.0fms", request.session_id, lang, duration_ms)

    return {
        "session_id":  request.session_id,
        "response":    answer,
        "audio_url":   audio_url,
        "language":    lang,
        "duration_ms": round(duration_ms, 2),
        "timestamp":   datetime.utcnow().isoformat(),
    }


@router.post("/text-chat/stream")
async def text_chat_stream(request: TextChatRequest):
    """Streaming SSE text chat with language detection."""
    get_or_create_session(request.session_id)
    lang = detect_language(request.message)
    history = get_history(request.session_id)
    full_parts: list[str] = []

    async def event_generator():
        try:
            async for chunk in chat_completion_stream(history, request.message, lang=lang):
                full_parts.append(chunk)
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logger.error("Streaming error: %s", e)
            yield f"data: [ERROR] {str(e)}\n\n"
        finally:
            if full_parts:
                full = "".join(full_parts)
                add_turn(request.session_id, request.message, full)
                log_conversation(request.session_id, request.message, full, 0, "text-stream")
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
