"""
Single Student Call API Routes - Handle individual student calls.

These routes are a thin wrapper around the SAME unified conversation pipeline
used by the Voice Testing Console (/api/conversation/test) and the real
application (/api/conversation/process):

    Microphone/Text -> Conversation Manager -> Language Detection
        -> Whisper -> Retriever (FAISS) -> Groq LLM -> Edge-TTS -> Speaker

There is exactly ONE active knowledge base (the latest uploaded PDF). The
single-call flow never touches the testing-console JSON knowledge.
"""

import uuid
from typing import Optional
from datetime import datetime, timezone
import base64

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.connection import get_database
from app.database.models import Institute, Knowledge, KnowledgeStatus, CallHistory, CallStatus
from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
from app.rag.groq_service import generate_response
from app.tts.edge_tts_service import get_tts_service
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/single-call", tags=["Single Call"])

# Per-call conversation memory (same in-memory pattern as conversation_routes).
# Created when a call starts and deleted when the call ends.
_call_memory: dict = {}

_tts_service = get_tts_service()


def _get_memory(call_id: str) -> list:
    """Get (or lazily create) the in-memory transcript for a call."""
    if call_id not in _call_memory:
        _call_memory[call_id] = []
    return _call_memory[call_id]


async def _speak(text: str, language: str) -> Optional[str]:
    """Synthesize speech via Edge-TTS and return base64-encoded MP3 (or None)."""
    audio_bytes = await _tts_service.synthesize(text, language=language)
    return base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else None


async def _build_history(memory: list) -> list:
    """Convert flat transcript into alternating user/model history for the LLM."""
    history = []
    for i, msg in enumerate(memory[-6:]):
        role = "user" if i % 2 == 0 else "model"
        history.append({"role": role, "content": msg})
    return history


@router.post("/initiate")
async def initiate_single_call(
    institute_id: int = Query(...),
    student_name: str = Query("Caller"),
    phone_number: str = Query("+910000000000"),
    language: str = Query("English"),
    session: AsyncSession = Depends(get_database),
):
    """
    Start a single student call.

    Validates that the institute's knowledge base is READY (the only active
    knowledge base), then generates the AI greeting through RAG + Groq + TTS.
    """
    try:
        result = await session.execute(
            select(Institute).where(Institute.id == institute_id)
        )
        institute = result.scalar_one_or_none()
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")

        knowledge_result = await session.execute(
            select(Knowledge)
            .where(Knowledge.institute_id == institute_id)
            .order_by(Knowledge.id.desc())
            .limit(1)
        )
        knowledge = knowledge_result.scalar_one_or_none()
        if not knowledge or knowledge.status != KnowledgeStatus.READY:
            raise HTTPException(
                status_code=400,
                detail="Knowledge base not ready. Please upload institute knowledge first.",
            )

        call_id = f"call_{uuid.uuid4().hex[:12]}"
        call_record = CallHistory(
            call_id=call_id,
            institute_id=institute_id,
            caller_number=phone_number,
            caller_name=student_name,
            call_status=CallStatus.INCOMING,
            started_at=datetime.now(timezone.utc),
        )
        session.add(call_record)
        await session.commit()
        await session.refresh(call_record)

        # ── Greeting through the unified pipeline ─────────────────────────
        retrieved = await retrieve_context("institute name college school admission", top_k=5, min_score=0.1)
        context_text = format_context_for_prompt(retrieved)

        greeting_prompt = (
            "You are Mrs. D, an AI Admission Counsellor.\n"
            f"Generate a warm, professional 2-3 sentence greeting for {student_name}.\n"
            f"Institute context:\n{context_text if context_text else 'General admission inquiry'}\n"
            "Generate ONLY the greeting text."
        )
        try:
            greeting = await generate_response(
                conversation_history=[],
                context=context_text,
                user_message=greeting_prompt,
            )
        except ValueError as e:
            logger.warning("Groq API not configured, using fallback greeting: %s", e)
            greeting = f"Hi! I'm Mrs.D, AI Admission Counsellor of {institute.name}. How may I help you today?"

        memory = _get_memory(call_id)
        memory.append(greeting)
        audio_data = await _speak(greeting, language)

        logger.info("Single call %s initiated for %s (knowledge: %s)", call_id, student_name, knowledge.document_name)

        return {
            "success": True,
            "call_id": call_id,
            "student_name": student_name,
            "knowledge_document": knowledge.document_name,
            "greeting": greeting,
            "audio_data": audio_data,
            "message": "Call initiated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error initiating single call: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-speech")
async def process_speech(
    call_id: str = Query(...),
    speech_text: str = Query(...),
    language: str = Query("English"),
    session: AsyncSession = Depends(get_database),
):
    """
    Process student speech during a call and generate the AI response.

    Uses the same RAG -> Groq -> Edge-TTS pipeline as the testing console,
    with per-call memory scoped to this call only.
    """
    try:
        result = await session.execute(
            select(CallHistory).where(CallHistory.call_id == call_id)
        )
        call_record = result.scalar_one_or_none()
        if not call_record:
            raise HTTPException(status_code=404, detail="Call not found")

        memory = _get_memory(call_id)
        memory.append(speech_text)

        retrieved = await retrieve_context(speech_text, top_k=5)
        context_text = format_context_for_prompt(retrieved)

        try:
            response = await generate_response(
                conversation_history=await _build_history(memory[:-1]),
                context=context_text,
                user_message=speech_text,
            )
        except ValueError as e:
            logger.warning("Groq API not configured, using fallback: %s", e)
            if context_text:
                response = f"Based on the information I have: {context_text[:500]}"
            else:
                response = "I apologize, but I need more information to help you. Could you please provide more details?"

        memory.append(response)

        # Update transcript on the call record
        transcript = "\n".join(
            f"{'Student' if i % 2 == 0 else 'Mrs. D'}: {msg}"
            for i, msg in enumerate(memory)
        )
        call_record.transcript = transcript
        call_record.total_turns = len(memory)
        call_record.call_status = CallStatus.ANSWERED
        await session.commit()

        audio_data = await _speak(response, language)

        return {
            "success": True,
            "call_id": call_id,
            "response": response,
            "audio_data": audio_data,
            "knowledge_ready": is_knowledge_ready(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error processing speech: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/end-call")
async def end_call(
    call_id: str = Query(...),
    session: AsyncSession = Depends(get_database),
):
    """
    End a call, complete the call record, and delete its memory.
    Memory lives ONLY inside one conversation - call starts, memory is created,
    call ends, memory is deleted.
    """
    try:
        result = await session.execute(
            select(CallHistory).where(CallHistory.call_id == call_id)
        )
        call_record = result.scalar_one_or_none()
        if not call_record:
            raise HTTPException(status_code=404, detail="Call not found")

        now = datetime.now(timezone.utc)
        call_record.call_status = CallStatus.COMPLETED
        call_record.ended_at = now
        if call_record.started_at:
            call_record.duration_seconds = max(
                0, int((now - call_record.started_at).total_seconds())
            )

        memory = _call_memory.pop(call_id, [])
        await session.commit()

        return {
            "success": True,
            "call_id": call_id,
            "duration_seconds": call_record.duration_seconds,
            "total_turns": len(memory),
            "message": "Call ended and memory cleared",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error ending call: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
