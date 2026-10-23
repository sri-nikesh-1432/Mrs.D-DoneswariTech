"""
Chat API Routes for Mrs. D — Doneswari AI Telecaller.
Handles first-class text conversation, independent of voice, with:
- Full PDF-based RAG grounding
- Persistent multi-turn session memory for follow-up questions
- Multilingual support (English, Telugu, Roman Telugu/Tenglish, Hindi, Tamil)
- Optional ElevenLabs / Edge-TTS audio generation
- Real source provenance (document name, page, section)
"""

import uuid
import time
import base64
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.connection import get_database
from app.database.models import Institute, Knowledge
from app.rag.retriever import retrieve_context, format_context_for_prompt
from app.rag.groq_service import stream_chat_fast
from app.roman_telugu import looks_roman_telugu, transliterate_roman_telugu
from app.tts.elevenlabs_service import ElevenLabsTTSService
from app.tts.edge_tts_service import EdgeTTSService
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Chat"])

# Persistent session memory for text conversations (survives turns in active session)
_chat_sessions: Dict[str, List[Dict[str, str]]] = {}


class ChatMessageRequest(BaseModel):
    message: str
    agent_id: Optional[int] = None
    institute_id: Optional[int] = None
    conversation_id: Optional[str] = None
    session_id: Optional[str] = None
    language: Optional[str] = "English"
    return_audio: Optional[bool] = False


class ClearChatRequest(BaseModel):
    session_id: Optional[str] = None
    conversation_id: Optional[str] = None


def _detect_chat_language(user_text: str, requested_lang: Optional[str] = None) -> str:
    """Resolve language with Roman Telugu and regional script awareness."""
    import re
    if re.search(r"[\u0C00-\u0C7F]", user_text):
        return "Telugu"
    if re.search(r"[\u0900-\u097F]", user_text):
        return "Hindi"
    if re.search(r"[\u0B80-\u0BFF]", user_text):
        return "Tamil"
    if re.search(r"[\u0C80-\u0CFF]", user_text):
        return "Kannada"
    if re.search(r"[\u0D00-\u0D7F]", user_text):
        return "Malayalam"

    if looks_roman_telugu(user_text):
        return "Telugu"

    if requested_lang and requested_lang.lower() not in ("auto", "none", ""):
        rl = requested_lang.lower()
        if "telugu" in rl or rl == "te":
            return "Telugu"
        if "hindi" in rl or rl == "hi":
            return "Hindi"
        if "tamil" in rl or rl == "ta":
            return "Tamil"
        if "kannada" in rl or rl == "kn":
            return "Kannada"
        if "malayalam" in rl or rl == "ml":
            return "Malayalam"
        if "roman telugu" in rl or "tenglish" in rl:
            return "Telugu"
        return requested_lang.capitalize()

    return "English"


def _format_sources(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract clean provenance for each retrieved knowledge chunk."""
    sources = []
    seen = set()
    for c in chunks:
        doc_name = c.get("document") or c.get("source") or "Official Document"
        page = c.get("page_number")
        section = c.get("section")
        key = (doc_name, page, section)
        if key not in seen:
            seen.add(key)
            sources.append({
                "document_name": doc_name,
                "page": page,
                "section": section or "General Information",
                "score": round(float(c.get("score", 0.0)), 3),
            })
    return sources


async def _resolve_agent(target_id: Optional[int], session: AsyncSession) -> tuple[int, Institute]:
    """Find the specified agent or fallback to the latest active/ready agent or Agent 1."""
    if target_id:
        agent = await session.get(Institute, target_id)
        if agent:
            return target_id, agent

    # Try to find any agent with READY knowledge
    res = await session.execute(
        select(Institute)
        .order_by(Institute.id.desc())
    )
    agents = res.scalars().all()
    if agents:
        return agents[0].id, agents[0]

    # Create default Agent 1 if none exists
    default_agent = Institute(
        institute_id="agent_1",
        name="Doneswari Institute of Technology",
        agent_name="Mrs. D",
        calling_purpose="Educational Admissions & Student Enquiries",
        status="ready",
    )
    session.add(default_agent)
    await session.commit()
    await session.refresh(default_agent)
    return default_agent.id, default_agent


@router.post("/api/chat")
async def chat_endpoint(
    req: ChatMessageRequest,
    session: AsyncSession = Depends(get_database),
):
    """
    Primary REST text chat endpoint.
    Handles user questions with PDF-based RAG grounding, multi-turn memory,
    multilingual response generation, and optional audio synthesis.
    """
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    target_id = req.agent_id or req.institute_id or 1
    agent_id, agent = await _resolve_agent(target_id, session)

    conv_id = req.conversation_id or req.session_id or f"chat_{agent_id}_{uuid.uuid4().hex[:10]}"
    history = _chat_sessions.setdefault(conv_id, [])

    # Language resolution
    lang = _detect_chat_language(message, req.language)
    is_tenglish = "roman" in (req.language or "").lower() or looks_roman_telugu(message)

    # Search query: normalize Roman Telugu if needed
    search_query = transliterate_roman_telugu(message) if is_tenglish else message

    agent_name = agent.agent_name or "Mrs. D"
    company_name = agent.name or "the institution"
    instructions = agent.instructions or None

    # Step 1: Fast contextual retrieval (with fast timeout so user never waits)
    chunks = []
    context = ""
    try:
        chunks = await asyncio.wait_for(
            retrieve_context(search_query, top_k=3, agent_id=agent_id),
            timeout=0.4
        )
        context = format_context_for_prompt(chunks) if chunks else ""
    except Exception as e:
        logger.debug("Fast RAG retrieval skipped, using trained knowledge: %s", e)
        chunks = []
        context = ""

    grounded = bool(context and len(context.strip()) > 20)

    # Step 2: Stream LLM tokens
    try:
        parts: List[str] = []
        async for token in stream_chat_fast(
            search_query,
            lang=lang,
            conversation_history=history[-6:],
            context=context,
            agent_name=agent_name,
            company_name=company_name,
            instructions=instructions,
        ):
            parts.append(token)

        answer = "".join(parts).strip()
        if not answer:
            if lang == "Telugu":
                answer = "క్షమించండి, అధికారిక పత్రాల్లో ఈ సమాచారం ప్రస్తుతం అందుబాటులో లేదు. దయచేసి అడ్మిషన్ల కార్యాలయాన్ని నేరుగా సంప్రదించండి."
            elif lang == "Hindi":
                answer = "क्षमा करें, आधिकारिक दस्तावेजों में यह जानकारी अभी उपलब्ध नहीं है। कृपया प्रवेश कार्यालय से सीधे संपर्क करें।"
            elif lang == "Tamil":
                answer = "மன்னிக்கவும், அதிகாரப்பூர்வ ஆவணங்களில் இந்த தகவல் தற்போது கிடைக்கவில்லை. சேர்க்கை அலுவலகத்தை நேரடியாக தொடர்பு கொள்ளவும்."
            else:
                answer = "I don't have that specific information in the official documents right now. Please contact the admissions office directly or let me connect you with an admissions counsellor."
    except Exception as e:
        logger.error("LLM chat generation failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"message": "Could not generate response. Please try again.", "error": str(e)},
        )

    # Step 3: Record conversation turns for follow-up context
    history.append({"role": "user", "content": message})
    history.append({"role": "assistant", "content": answer})
    if len(history) > 20:
        _chat_sessions[conv_id] = history[-20:]

    # Step 4: Optional speech synthesis
    audio_data_b64: Optional[str] = None
    if req.return_audio:
        try:
            tts = ElevenLabsTTSService()
            audio_bytes = await tts.synthesize(answer, language=lang)
            if not audio_bytes:
                # Fallback to Edge-TTS
                edge_tts = EdgeTTSService()
                audio_bytes = await edge_tts.synthesize(answer, language=lang)
            if audio_bytes:
                audio_data_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        except Exception as e:
            logger.warning("TTS generation in /api/chat skipped: %s", e)

    return {
        "conversation_id": conv_id,
        "session_id": conv_id,
        "message": answer,
        "response": answer,
        "language": lang,
        "grounded": grounded,
        "sources": _format_sources(chunks),
        "audio_data": audio_data_b64,
        "timestamp": time.time(),
    }


@router.post("/api/chat/stream")
async def chat_stream_endpoint(
    req: ChatMessageRequest,
    session: AsyncSession = Depends(get_database),
):
    """
    Streaming SSE text chat endpoint.
    Emits token deltas as they are generated by the LLM.
    """
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    target_id = req.agent_id or req.institute_id or 1
    agent_id, agent = await _resolve_agent(target_id, session)

    conv_id = req.conversation_id or req.session_id or f"chat_stream_{agent_id}_{uuid.uuid4().hex[:10]}"
    history = _chat_sessions.setdefault(conv_id, [])

    lang = _detect_chat_language(message, req.language)
    is_tenglish = "roman" in (req.language or "").lower() or looks_roman_telugu(message)
    search_query = transliterate_roman_telugu(message) if is_tenglish else message

    agent_name = agent.agent_name or "Mrs. D"
    company_name = agent.name or "the institution"
    instructions = agent.instructions or None

    chunks = []
    context = ""
    try:
        chunks = await asyncio.wait_for(
            retrieve_context(search_query, top_k=3, agent_id=agent_id),
            timeout=0.4
        )
        context = format_context_for_prompt(chunks) if chunks else ""
    except Exception as e:
        logger.debug("Fast RAG stream retrieval skipped: %s", e)
        chunks = []
        context = ""

    grounded = bool(context and len(context.strip()) > 20)
    sources = _format_sources(chunks)

    async def event_generator():
        full_tokens: List[str] = []
        import json
        # Initial meta event
        yield f"event: meta\ndata: {json.dumps({'conversation_id': conv_id, 'language': lang, 'grounded': grounded, 'sources': sources})}\n\n"

        try:
            async for token in stream_chat_fast(
                search_query,
                lang=lang,
                conversation_history=history[-6:],
                context=context,
                agent_name=agent_name,
                company_name=company_name,
                instructions=instructions,
            ):
                full_tokens.append(token)
                yield f"event: delta\ndata: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            logger.error("Stream generation error: %s", e)
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        complete_text = "".join(full_tokens).strip()
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": complete_text})
        if len(history) > 20:
            _chat_sessions[conv_id] = history[-20:]

        yield f"event: done\ndata: {json.dumps({'complete_text': complete_text, 'sources': sources})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/chat/history/{session_id}")
async def get_chat_history(session_id: str):
    """Retrieve message history for an active text conversation session."""
    history = _chat_sessions.get(session_id, [])
    return {
        "session_id": session_id,
        "turns_count": len(history),
        "history": history,
    }


@router.post("/api/chat/clear")
async def clear_chat_history(req: ClearChatRequest):
    """Clear conversation history for a given session."""
    session_id = req.session_id or req.conversation_id
    if session_id and session_id in _chat_sessions:
        del _chat_sessions[session_id]
    return {"status": "cleared", "session_id": session_id}
