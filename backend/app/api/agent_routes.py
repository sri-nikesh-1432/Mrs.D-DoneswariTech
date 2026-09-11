"""
Agent API Routes
Handles agent settings, publish, and REST text-chat fallback.

Endpoints:
  GET  /api/agents/{id}/settings
  PATCH /api/agents/{id}/settings
  POST /api/agents/{id}/publish
  POST /api/chat           — REST text chat (fallback when WS is unavailable)
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import Institute, Knowledge, KnowledgeStatus
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Agents"])

# ─── In-memory publish store (augments the DB) ────────────────────────────
# {institute_id: {"version": "v1", "published_at": ...}}
_publish_registry: dict = {}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _agent_name_from(institute: Institute) -> str:
    """Extract agent name stored in the greeting_message sentinel."""
    gm = institute.greeting_message or ""
    if gm.startswith("__agent_name__:"):
        return gm.split(":", 1)[1]
    return "Mrs.D"


async def _get_institute_or_404(institute_id: int, session: AsyncSession) -> Institute:
    result = await session.execute(
        select(Institute).where(Institute.id == institute_id)
    )
    inst = result.scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Agent not found")
    return inst


# ─── Settings ────────────────────────────────────────────────────────────────

class AgentSettingsPatch(BaseModel):
    agent_name: Optional[str] = None
    business_name: Optional[str] = None
    phone_number: Optional[str] = None
    supported_languages: Optional[list] = None
    voice: Optional[str] = None
    voice_speed: Optional[float] = None
    background_ambience: Optional[bool] = None
    greeting: Optional[str] = None


@router.get("/api/agents/{agent_id}/settings")
async def get_agent_settings(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    inst = await _get_institute_or_404(agent_id, session)

    # Latest knowledge record
    kq = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent_id)
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    knowledge = kq.scalar_one_or_none()

    pub = _publish_registry.get(agent_id, {})

    return {
        "agent_name": _agent_name_from(inst),
        "business_name": inst.name,
        "phone_number": inst.phone_number,
        "supported_languages": ["English", "Telugu", "Hindi", "Tamil"],
        "voice": inst.voice or "en-IN-NeerjaNeural",
        "voice_speed": 1.15,
        "background_ambience": False,
        "greeting": inst.greeting_message if inst.greeting_message and not inst.greeting_message.startswith("__agent_name__:") else f"Hi, this is {_agent_name_from(inst)} from {inst.name}. How can I help you?",
        "knowledge_file": knowledge.document_name if knowledge else None,
        "knowledge_status": knowledge.status.value if knowledge else "not_uploaded",
        "published_version": pub.get("version"),
    }


@router.patch("/api/agents/{agent_id}/settings")
async def update_agent_settings(
    agent_id: int,
    body: AgentSettingsPatch,
    session: AsyncSession = Depends(get_database),
):
    inst = await _get_institute_or_404(agent_id, session)

    if body.business_name is not None:
        inst.name = body.business_name
    if body.phone_number is not None:
        inst.phone_number = body.phone_number
    if body.voice is not None:
        inst.voice = body.voice
    if body.agent_name is not None:
        # Store agent name in greeting_message sentinel
        inst.greeting_message = f"__agent_name__:{body.agent_name}"
    if body.greeting is not None and body.greeting and not body.greeting.startswith("__agent_name__:"):
        # Only store a real greeting (not the sentinel), and only if agent name is not being set
        if body.agent_name is None:
            inst.greeting_message = body.greeting

    await session.commit()
    await session.refresh(inst)
    return await get_agent_settings(agent_id, session)


# ─── Publish ─────────────────────────────────────────────────────────────────

@router.post("/api/agents/{agent_id}/publish")
async def publish_agent(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    inst = await _get_institute_or_404(agent_id, session)

    # Check knowledge is ready
    kq = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent_id)
        .where(Knowledge.status == KnowledgeStatus.READY)
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    knowledge = kq.scalar_one_or_none()
    if not knowledge:
        raise HTTPException(
            status_code=400,
            detail="Knowledge base is not ready. Please upload and process a PDF first.",
        )

    # Increment version
    current = _publish_registry.get(agent_id, {})
    current_v = int(current.get("version", "v0").lstrip("v") or 0)
    new_version = f"v{current_v + 1}"

    from datetime import datetime, timezone
    _publish_registry[agent_id] = {
        "version": new_version,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "knowledge_id": knowledge.id,
    }

    logger.info("Agent %d published as %s", agent_id, new_version)

    return {
        "version": new_version,
        "agent_id": agent_id,
        "status": "published",
        "message": f"Agent {_agent_name_from(inst)} is now live as {new_version}",
    }


# ─── REST Text Chat (fallback) ────────────────────────────────────────────────

class ChatRequest(BaseModel):
    institute_id: int
    message: str
    session_id: Optional[str] = None
    language: Optional[str] = "English"


# Per-session memory (REST chat — lightweight in-memory)
_chat_sessions: dict = {}  # session_id -> [{role, content}]
MAX_SESSION_HISTORY = 10


@router.post("/api/chat")
async def text_chat(body: ChatRequest):
    """
    REST text-chat endpoint. Used by the frontend when the WebSocket is
    unavailable or as a text-only mode.

    Full RAG + LLM pipeline. Response is complete (not streaming).
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    session_id = body.session_id or f"rest_{body.institute_id}"
    history = _chat_sessions.get(session_id, [])

    try:
        # RAG retrieval
        from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
        context = ""
        if is_knowledge_ready():
            chunks = await retrieve_context(body.message, top_k=4)
            context = format_context_for_prompt(chunks)

        # Build trimmed history (last 3 turns)
        trimmed_history = []
        for turn in history[-6:]:
            trimmed_history.append({
                "role": turn["role"],
                "content": str(turn["content"])[:200],
            })

        # LLM
        from app.rag.groq_service import stream_chat_fast
        response_parts = []
        async for token in stream_chat_fast(
            body.message,
            lang=body.language or "English",
            conversation_history=trimmed_history,
            context=context,
        ):
            response_parts.append(token)

        response_text = "".join(response_parts).strip()
        if not response_text:
            response_text = "Sorry, I couldn't generate a response. Please try again."

        # Update session memory
        history.append({"role": "user", "content": body.message})
        history.append({"role": "assistant", "content": response_text})
        if len(history) > MAX_SESSION_HISTORY * 2:
            history = history[-(MAX_SESSION_HISTORY * 2):]
        _chat_sessions[session_id] = history

        # Extract memory hints from response (simple heuristic)
        memory_update = _extract_memory_hints(body.message, response_text)

        return {
            "response": response_text,
            "session_id": session_id,
            "memory": memory_update,
        }

    except Exception as e:
        logger.error("REST chat failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Chat error: {e}")


def _extract_memory_hints(user_msg: str, ai_msg: str) -> dict:
    """Very lightweight heuristic to pull out lead info from the conversation turn."""
    import re
    hints = {}
    combined = f"{user_msg} {ai_msg}".lower()

    # Class
    m = re.search(r"class\s+([1-9]|1[012]|ix|viii|vii|vi|xi|xii|x)\b", combined)
    if m:
        hints["student_class"] = f"Class {m.group(1).upper()}"

    # Course mentions
    for course in ["etechno", "echamps", "ekidz", "senior secondary", "junior", "cbse"]:
        if course in combined:
            hints["course_interest"] = course.replace("e", "e").title()
            break

    # Hostel
    if "hostel" in combined:
        hints["hostel"] = "Interested" if any(w in combined for w in ["need", "want", "yes", "interested"]) else "Enquired"

    return hints
