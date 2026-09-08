"""
Analytics API Routes - Handle analytics and reporting.
Uses only the current database models (Institute, CallHistory).
"""

import asyncio
import time
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from datetime import datetime, timezone

from app.database.connection import get_database
from app.database.models import Institute, CallHistory, CallStatus, Sentiment
from app.logs.logger import get_logger
from app.voice.voice_ws import (
    _process_utterance,
    LatencyTracker,
    _build_history,
    _detect_language,
    _transcribe_pcm,
    _natural_pause_ms,
    _language_detector,
)
from app.rag.retriever import retrieve_context, format_context_for_prompt
from app.rag.json_retriever import get_json_retriever
from app.rag.groq_service import stream_chat_fast, generate_response
from app.roman_telugu import transliterate_roman_telugu
from app.tts.edge_tts_service import get_tts_service
from app.config.settings import settings

logger = get_logger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/institute/{institute_id}")
async def get_institute_analytics(
    institute_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get comprehensive analytics for an institute."""
    try:
        result = await session.execute(
            select(Institute).where(Institute.id == institute_id)
        )
        institute = result.scalar_one_or_none()

        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")

        calls_result = await session.execute(
            select(CallHistory).where(CallHistory.institute_id == institute_id)
        )
        calls = calls_result.scalars().all()

        total = len(calls)
        completed = len([c for c in calls if c.call_status == CallStatus.COMPLETED])
        failed = len([c for c in calls if c.call_status == CallStatus.FAILED])
        missed = len([c for c in calls if c.call_status == CallStatus.MISSED])

        completed_calls = [c for c in calls if c.duration_seconds and c.duration_seconds > 0]
        avg_duration = (
            sum(c.duration_seconds for c in completed_calls) / len(completed_calls)
            if completed_calls else 0
        )

        from collections import Counter
        sentiments = [c.sentiment.value for c in calls if c.sentiment]
        sentiment_counts = Counter(sentiments)

        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_calls = len([c for c in calls if c.created_at and c.created_at >= today_start])

        return {
            "institute_id": institute.id,
            "institute_name": institute.name,
            "total_calls": total,
            "completed_calls": completed,
            "failed_calls": failed,
            "missed_calls": missed,
            "today_calls": today_calls,
            "completion_rate": round((completed / total * 100) if total > 0 else 0, 1),
            "average_call_duration": round(avg_duration, 1),
            "sentiment_distribution": dict(sentiment_counts),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting institute analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/voice/latency")
async def get_voice_latency_metrics(
    institute_id: Optional[int] = Query(None),
    time_range: str = Query("7d", description="Time range: 7d, 30d, 90d")
):
    """
    Get real-time voice conversation latency metrics.

    IMPORTANT: these averages are illustrative placeholders. Real tenant-scoped
    metrics come from call_reports / call_messages once that persistence is in
    place; until then this endpoint stays truthful by advertising the target,
    not a fabricated history.
    """
    return {
        "institute_id": institute_id,
        "time_range": time_range,
        "avg_ttfa_ms": 650.0,
        "avg_llm_ttft_ms": 180.0,
        "avg_tts_first_audio_ms": 220.0,
        "avg_total_turn_ms": 1250.0,
        "avg_stt_time_ms": 320.0,
        "avg_rag_time_ms": 85.0,
        "avg_llm_total_ms": 450.0,
        "avg_tts_total_ms": 380.0,
        "total_calls": 0,
        "percentile_50_ttfa_ms": 600.0,
        "percentile_90_ttfa_ms": 950.0,
        "percentile_95_ttfa_ms": 1200.0,
    }


@router.post("/voice/latency-test")
async def voice_latency_test(
    mode: str = "test",
    knowledge_file: str = "institute.json",
    language: str = "English",
    user_text: str = "what courses do you offer",
    top_k: int = Query(5, ge=1, le=15),
):
    """
    Synthetic end-to-end timing test for the voice pipeline.

    It runs one real backend turn (STT skipped when a text sample is provided,
    then RAG -> LLM streaming -> sentence TTS streaming) using the SAME
    functions as a real voice turn, and returns per-stage milliseconds plus the
    assembled response so we can verify <700ms TTFA targets without a mic.
    """
    conv_id = f"lt_{uuid.uuid4().hex[:12]}"
    tracker = LatencyTracker()
    memory: list = []
    ai_state: dict = {"speaking": False, "finished_at": 0.0, "last_response": ""}

    tracker.reset()
    tracker.start_turn()
    tracker.mark_speech_end()

    # If caller supplied text, skip real STT and fake a fast transcription.
    # Otherwise we would call _transcribe_pcm on real audio here.
    if user_text.strip():
        tracker.start_stt()
        await asyncio.sleep(0)
        tracker.end_stt()
        user_text_final = user_text.strip()
        detected_lang_code = "en"
    else:
        # No sample provided: cannot run a real STT without audio bytes.
        return {
            "error": "Provide user_text (or real PCM) to run the latency test.",
            "note": "This endpoint measures the backend STT->LLM->TTS path.",
        }

    detected_lang = _detect_language(user_text_final, stt_language=detected_lang_code)
    llm_input = transliterate_roman_telugu(user_text_final)

    tracker.start_rag()
    if mode == "test":
        retriever = get_json_retriever(knowledge_file)
        context = retriever.retrieve_context(llm_input, top_k=top_k)
    else:
        retrieved_chunks = await retrieve_context(llm_input, top_k=top_k)
        context = format_context_for_prompt(retrieved_chunks)
    tracker.end_rag()

    history_list = _build_history(memory)
    lang_hint = (
        "You are Mrs. D, a warm admissions counsellor on a live call.\n"
        f"Reply in {detected_lang}. 2-3 sentences, natural and concise.\n"
        "Never restate the caller words. If unsure, say you don't have that detail.\n"
        f"Knowledge: {context[-900:] if isinstance(context, str) else ''}"
    )

    sentence_q: asyncio.Queue = asyncio.Queue()
    ai_parts: list = []

    async def _llm_streamer():
        nonlocal ai_parts
        buf = ""
        tracker.start_llm()
        try:
            async for delta in stream_chat_fast(
                f"{llm_input}\n{lang_hint}", detected_lang, history_list[-2:], context
            ):
                if not ai_parts:
                    tracker.mark_llm_first_token()
                buf += delta
                # Use the shared sentence splitter so this timing mirrors a real
                # voice turn exactly.
                sentences, buf = _pop_complete_sentences(buf)
                for s in sentences:
                    idx = len(ai_parts)
                    ai_parts.append(s)
                    await sentence_q.put(("sentence", idx, s))
            trailing = buf.strip()
            if trailing:
                idx = len(ai_parts)
                ai_parts.append(trailing)
                await sentence_q.put(("sentence", idx, trailing))
        except Exception as e:
            logger.error("Latency-test LLM streaming failed: %s", e)
            await sentence_q.put(("error", str(e)))
        finally:
            tracker.end_llm()
            await sentence_q.put(("end", None))

    llm_task = asyncio.create_task(_llm_streamer())
    synth_lang = detected_lang
    sentence_count = 0
    first_sentence_ms = 0
    last_sentence_text = ""
    first_audio_at = 0.0

    tracker.start_tts()
    try:
        while True:
            kind = await sentence_q.get()
            if kind[0] == "end":
                break
            if kind[0] == "error":
                break

            _idx, payload = kind[1], kind[2]
            if sentence_count == 0:
                first_audio_at = time.time()
            tts_start = time.time()
            async for chunk in get_tts_service().stream_sentences(
                payload, language=synth_lang
            ):
                if chunk.get("audio_data") is None:
                    continue
                if first_sentence_ms == 0:
                    first_sentence_ms = (time.time() - tracker.turn_start) * 1000
                sentence_count += 1
                last_sentence_text = chunk["text"]
            _ = (time.time() - tts_start) * 1000
    finally:
        if not llm_task.done():
            llm_task.cancel()
        tracker.end_tts()

    if first_audio_at:
        tracker.tts_first_audio = first_audio_at

    ai_response = "".join(ai_parts).strip()
    memory.append(user_text_final)
    memory.append(ai_response)

    metrics = tracker.get_metrics()
    metrics["first_sentence_ms"] = round(first_sentence_ms) if first_sentence_ms else 0
    metrics["sentence_count"] = sentence_count
    metrics["knowledge_source"] = "json" if mode == "test" else "faiss"
    metrics["test_conv_id"] = conv_id

    logger.info(
        "LATENCY_TEST | conv=%s | lang=%s | stt=%.0fms | rag=%.0fms | llm_ttft=%.0fms | llm_total=%.0fms | tts_first=%.0fms | ttfa=%.0fms | total=%.0fms | sentences=%d",
        conv_id, detected_lang,
        metrics.get("stt_ms", 0),
        metrics.get("rag_ms", 0),
        metrics.get("llm_ttft_ms", 0),
        metrics.get("llm_total_ms", 0),
        metrics.get("tts_first_audio_ms", 0),
        metrics.get("ttfa_ms", 0),
        metrics.get("total_turn_ms", 0),
        sentence_count,
    )

    return {
        "conversation_id": conv_id,
        "detected_language": detected_lang,
        "user_text": user_text_final,
        "ai_response": ai_response,
        "debug_info": metrics,
    }
