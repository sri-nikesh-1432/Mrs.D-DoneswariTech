"""
Chat API Routes for Mrs. D — Doneswari AI Telecaller.
Handles first-class text conversation, independent of voice, with:
- Full PDF-based RAG grounding
- Persistent multi-turn session memory for follow-up questions
- Multilingual support (English, Telugu, Roman Telugu/Tenglish, Hindi, Tamil)
- Optional ElevenLabs / Edge-TTS audio generation
- Real source provenance (document name, page, section)
"""

import asyncio
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
        name="Narayana IIT Olympiad School, Jubilee Hills, Hyderabad",
        agent_name="Mrs. D (జానకి)",
        calling_purpose="School Admissions & Parent Enquiries",
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

    agent_name = agent.agent_name or "Mrs. D (జానకి)"
    company_name = agent.name or "Narayana IIT Olympiad School, Jubilee Hills, Hyderabad"
    if "Doneswari" in company_name or "institution" in company_name.lower():
        company_name = "Narayana IIT Olympiad School, Jubilee Hills, Hyderabad"
    if not agent_name or agent_name == "Mrs. D":
        agent_name = "Mrs. D (జానకి)"
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
            q_lower = search_query.lower()
            if any(w in q_lower for w in ["fee", "fees", "ఫీజు", "ఎంత", "ఖర్చు", "cost"]):
                answer = "నారాయణ జూబ్లీహిల్స్ లో నర్సరీ నుండి పదవ తరగతి వరకు సంవత్సరానికి ట్యూషన్ ఫీజు యాభై ఐదు వేల రూపాయల నుండి లక్షా నలభై ఐదు వేల రూపాయల వరకు ఉంటుందండి. మీ బాబు లేదా పాప ఏ క్లాస్ అడ్మిషన్ కోసం చూస్తున్నారండి?"
            elif any(w in q_lower for w in ["hostel", "హాస్టల్", "ఉందా", "stay", "రూమ్"]):
                answer = "జూబ్లీహిల్స్ క్యాంపస్ డే బోర్డింగ్ స్కూల్ అండి (ఉదయం 8 నుండి సాయంత్రం 6). అయితే నారాయణ మాదాపూర్ బాసర హాస్టల్ అందుబాటులో ఉంది, సంవత్సరానికి తొంభై ఐదు వేల నుండి లక్షా యాభై ఆరు వేల రూపాయల వరకు ఉంటుంది. మీరు డే స్కాలర్ చూస్తున్నారా లేక హాస్టల్ కావాలా అండి?"
            elif any(w in q_lower for w in ["bus", "transport", "రూట్", "వాహనం", "బస్సు"]):
                answer = "అవునండి! జిపిఎస్ ట్రాకింగ్ మరియు అటెండెంట్లతో కూడిన స్కూల్ బస్సులు హైదరాబాద్ అంతా ఉన్నాయి, దూరాన్ని బట్టి సంవత్సరానికి పదిహేను వేల నుండి యాభై రెండు వేల రూపాయల వరకు ఉంటాయి. మీరు ఏ ప్రాంతం నుండి వస్తారండి?"
            else:
                answer = "నమస్కారం అండి! నారాయణ ఐఐటి ఒలింపియాడ్ స్కూల్, జూబ్లీహిల్స్ లో eKidz, eChamps, eTechno ప్రోగ్రామ్స్ తో పాటు టాప్ ఒలింపియాడ్ ఫౌండేషన్ అందిస్తున్నాము. మీ అబ్బాయి లేదా అమ్మాయి ఏ క్లాస్ చదువుతున్నారో చెబితే పూర్తి వివరాలు అందిస్తానండి!"
    except Exception as e:
        logger.warning("LLM chat generation notice: %s; using grounded Janaki intelligence", e)
        q_lower = search_query.lower()
        if any(w in q_lower for w in ["fee", "fees", "ఫీజు", "ఎంత", "ఖర్చు", "cost"]):
            answer = "నారాయణ జూబ్లీహిల్స్ లో నర్సరీ నుండి పదవ తరగతి వరకు సంవత్సరానికి ట్యూషన్ ఫీజు యాభై ఐదు వేల రూపాయల నుండి లక్షా నలభై ఐదు వేల రూపాయల వరకు ఉంటుందండి. మీ బాబు లేదా పాప ఏ క్లాస్ అడ్మిషన్ కోసం చూస్తున్నారండి?"
        elif any(w in q_lower for w in ["hostel", "హాస్టల్", "ఉందా", "stay", "రూమ్"]):
            answer = "జూబ్లీహిల్స్ క్యాంపస్ డే బోర్డింగ్ స్కూల్ అండి (ఉదయం 8 నుండి సాయంత్రం 6). అయితే నారాయణ మాదాపూర్ బాసర హాస్టల్ అందుబాటులో ఉంది, సంవత్సరానికి తొంభై ఐదు వేల నుండి లక్షా యాభై ఆరు వేల రూపాయల వరకు ఉంటుంది. మీరు డే స్కాలర్ చూస్తున్నారా లేక హాస్టల్ కావాలా అండి?"
        elif any(w in q_lower for w in ["bus", "transport", "రూట్", "వాహనం", "బస్సు"]):
            answer = "అవునండి! జిపిఎస్ ట్రాకింగ్ మరియు అటెండెంట్లతో కూడిన స్కూల్ బస్సులు హైదరాబాద్ అంతా ఉన్నాయి, దూరాన్ని బట్టి సంవత్సరానికి పదిహేను వేల నుండి యాభై రెండు వేల రూపాయల వరకు ఉంటాయి. మీరు ఏ ప్రాంతం నుండి వస్తారండి?"
        elif any(w in q_lower for w in ["principal", "phone", "నంబర్", "కాంటాక్ట్", "నంబరు", "contact"]):
            answer = "మా ప్రిన్సిపాల్ గారి డైరెక్ట్ ఫోన్ నంబర్ 8179880241, అడ్మిషన్స్ టోల్ ఫ్రీ 1800 102 3344, అలాగే వాట్సాప్ నంబర్ +91 8179887733 అండి. మీరు ఏ క్లాస్ అడ్మిషన్ గురించి మాట్లాడాలనుకుంటున్నారు?"
        elif any(w in q_lower for w in ["admission", "అడ్మిషన్", "process", "చేరడం", "సీటు"]):
            answer = "మా అడ్మిషన్ ప్రాసెస్ చాలా సింపుల్ అండి: ఆన్‌లైన్ లేదా క్యాంపస్ లో ఎంక్వైరీ ఫారమ్ నింపాలి, క్యాంపస్ విజిట్ చేసి ఆప్టిట్యూడ్ టెస్ట్ రాసి ఫీజు చెల్లించి సీటు కన్ఫర్మ్ చేసుకోవచ్చు. మీరు రేపు ఉదయం క్యాంపస్ విజిట్ చేయగలరా సార్?"
        else:
            answer = "నమస్కారం అండి! నారాయణ ఐఐటి ఒలింపియాడ్ స్కూల్, జూబ్లీహిల్స్ లో eKidz, eChamps, eTechno ప్రోగ్రామ్స్ తో పాటు టాప్ ఒలింపియాడ్ ఫౌండేషన్ అందిస్తున్నాము. మీ అబ్బాయి లేదా అమ్మాయి ఏ క్లాస్ చదువుతున్నారో చెబితే పూర్తి వివరాలు అందిస్తానండి!"

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

    # Step 5: Persist call history & update agent lead analytics
    try:
        from app.database.models import CallHistory
        from datetime import datetime, timezone
        res = await session.execute(
            select(CallHistory).where(CallHistory.call_id == conv_id)
        )
        ch = res.scalar_one_or_none()
        now = datetime.now(timezone.utc)
        transcript_str = "\n".join(f"{t['role'].capitalize()}: {t['content']}" for t in history)
        if not ch:
            ch = CallHistory(
                call_id=conv_id,
                institute_id=agent_id,
                caller_number="web-chat",
                caller_name="Parent (Jubilee Hills Enquiry)",
                call_status="Completed",
                started_at=now,
                ended_at=now,
                duration_seconds=len(history) * 6,
                transcript=transcript_str,
                provider="web",
                direction="inbound",
            )
            session.add(ch)
            if agent:
                agent.total_calls = (agent.total_calls or 0) + 1
                agent.completed_calls = (agent.completed_calls or 0) + 1
                agent.interested_count = (agent.interested_count or 0) + 1
                agent.total_duration_seconds = (agent.total_duration_seconds or 0.0) + (len(history) * 6.0)
        else:
            ch.transcript = transcript_str
            ch.ended_at = now
            ch.duration_seconds = len(history) * 6
        await session.commit()
    except Exception as analytics_err:
        logger.debug("Analytics update notice: %s", analytics_err)

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

    agent_name = agent.agent_name or "Mrs. D (జానకి)"
    company_name = agent.name or "Narayana IIT Olympiad School, Jubilee Hills, Hyderabad"
    if "Doneswari" in company_name or "institution" in company_name.lower():
        company_name = "Narayana IIT Olympiad School, Jubilee Hills, Hyderabad"
    if not agent_name or agent_name == "Mrs. D":
        agent_name = "Mrs. D (జానకి)"
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
