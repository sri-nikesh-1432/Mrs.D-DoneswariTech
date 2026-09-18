"""
Agent API Routes for Doneswari AI Telecaller Platform.
Handles Agent Creation, Naming, Configuration, Knowledge Onboarding, Testing, and Publishing.
"""

import os
import uuid
import asyncio
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import (
    Institute, Knowledge, KnowledgeStatus, AgentStatus, User, Workspace, Student, CallHistory
)
from app.api.auth_routes import get_current_user_optional, get_or_create_default_workspace
from app.rag.document_processor import validate_file, extract_text
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store_manager
from app.logs.logger import get_logger
from app.config.settings import settings

logger = get_logger(__name__)

router = APIRouter(tags=["Agents"])

# In-memory publish registry
_publish_registry: dict = {}


# ── Schemas ──────────────────────────────────────────────────────────────────

class AgentCreateRequest(BaseModel):
    name: str = "Aadhya"  # Agent name
    company_name: str = "Doneswari Technologies"
    phone_number: Optional[str] = "+91 98765 43210"
    calling_purpose: Optional[str] = "Admissions and Student Enquiry"
    description: Optional[str] = None
    language: Optional[str] = "en"
    voice: Optional[str] = "en-IN-NeerjaNeural"
    voice_speed: Optional[float] = 1.0
    greeting_message: Optional[str] = None
    instructions: Optional[str] = None


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    agent_name: Optional[str] = None
    business_name: Optional[str] = None
    company_name: Optional[str] = None
    phone_number: Optional[str] = None
    calling_purpose: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = None
    voice: Optional[str] = None
    voice_speed: Optional[float] = None
    greeting_message: Optional[str] = None
    instructions: Optional[str] = None
    status: Optional[str] = None


def _format_agent(inst: Institute, knowledge: Optional[Knowledge] = None) -> dict:
    agent_name = inst.agent_name or inst.name or "Aadhya"
    return {
        "id": inst.id,
        "agent_id": inst.institute_id,
        "name": inst.name,
        "agent_name": agent_name,
        "company_name": inst.name,
        "phone_number": inst.phone_number,
        "calling_purpose": inst.calling_purpose or "Admissions and Student Enquiry",
        "description": inst.description,
        "language": inst.language or "en",
        "voice": inst.voice or "en-IN-NeerjaNeural",
        "voice_speed": inst.voice_speed or 1.0,
        "greeting_message": inst.greeting_message or f"Hi, this is {agent_name} from {inst.name}. Is this a good time for a quick conversation?",
        "instructions": inst.instructions,
        "status": inst.status or AgentStatus.READY.value,
        "total_students": inst.total_students or 0,
        "calls_completed": inst.completed_calls or 0,
        "interested_count": inst.interested_count or 0,
        "follow_up_count": inst.follow_up_count or 0,
        "knowledge_ready": knowledge.status == KnowledgeStatus.READY if knowledge else False,
        "knowledge_document": knowledge.document_name if knowledge else None,
        "created_at": inst.created_at.isoformat() if inst.created_at else None,
        "updated_at": inst.updated_at.isoformat() if inst.updated_at else None,
    }


# ── CRUD Endpoints ───────────────────────────────────────────────────────────

@router.post("/api/agents")
async def create_agent(
    body: AgentCreateRequest,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Create a new AI telecaller agent."""
    user = await get_current_user_optional(authorization, session)
    user_id = user.id if user else None
    workspace_id = None
    if user:
        ws = await get_or_create_default_workspace(user.id, session, body.company_name)
        workspace_id = ws.id

    agent_uuid = f"agent_{uuid.uuid4().hex[:10]}"
    greeting = body.greeting_message or f"Hi, this is {body.name} from {body.company_name}. Is this a good time for a quick conversation?"

    agent = Institute(
        institute_id=agent_uuid,
        user_id=user_id,
        workspace_id=workspace_id,
        name=body.company_name,
        agent_name=body.name,
        phone_number=body.phone_number,
        calling_purpose=body.calling_purpose,
        description=body.description,
        language=body.language or "en",
        voice=body.voice or "en-IN-NeerjaNeural",
        voice_speed=body.voice_speed or 1.0,
        greeting_message=greeting,
        instructions=body.instructions,
        status=AgentStatus.DRAFT.value,
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)

    return _format_agent(agent)


@router.get("/api/agents")
async def list_agents(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """List all agents for the current user/workspace, with sensible defaults."""
    user = await get_current_user_optional(authorization, session)
    query = select(Institute).order_by(Institute.id.desc())
    if user:
        query = query.where((Institute.user_id == user.id) | (Institute.user_id == None))

    result = await session.execute(query)
    agents = result.scalars().all()

    # If no agent exists, ensure default Aadhya agent exists
    if not agents:
        default_agent = Institute(
            institute_id="agent_default",
            name="Doneswari Technologies",
            agent_name="Aadhya",
            phone_number="+91 98765 43210",
            calling_purpose="Admissions and Student Enquiry",
            language="en",
            voice="en-IN-NeerjaNeural",
            greeting_message="Hi, this is Aadhya from Doneswari. Is this a good time for a quick conversation?",
            status=AgentStatus.READY.value,
        )
        session.add(default_agent)
        await session.commit()
        await session.refresh(default_agent)
        agents = [default_agent]

    response = []
    for ag in agents:
        kq = await session.execute(
            select(Knowledge).where(Knowledge.institute_id == ag.id).order_by(Knowledge.id.desc()).limit(1)
        )
        k = kq.scalar_one_or_none()
        response.append(_format_agent(ag, k))

    return response


@router.get("/api/agents/{agent_id}")
async def get_agent(agent_id: int, session: AsyncSession = Depends(get_database)):
    """Get single agent by numeric ID."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    kq = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent.id).order_by(Knowledge.id.desc()).limit(1)
    )
    k = kq.scalar_one_or_none()
    return _format_agent(agent, k)


@router.patch("/api/agents/{agent_id}")
async def update_agent(
    agent_id: int,
    body: AgentUpdateRequest,
    session: AsyncSession = Depends(get_database),
):
    """Update agent configuration."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if body.agent_name is not None:
        agent.agent_name = body.agent_name
    elif body.name is not None:
        agent.agent_name = body.name

    if body.company_name is not None:
        agent.name = body.company_name
    elif body.business_name is not None:
        agent.name = body.business_name

    if body.phone_number is not None:
        agent.phone_number = body.phone_number
    if body.calling_purpose is not None:
        agent.calling_purpose = body.calling_purpose
    if body.description is not None:
        agent.description = body.description
    if body.language is not None:
        agent.language = body.language
    if body.voice is not None:
        agent.voice = body.voice
    if body.voice_speed is not None:
        agent.voice_speed = body.voice_speed
    if body.greeting_message is not None:
        agent.greeting_message = body.greeting_message
    if body.instructions is not None:
        agent.instructions = body.instructions
    if body.status is not None:
        agent.status = body.status

    await session.commit()
    await session.refresh(agent)

    kq = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent.id).order_by(Knowledge.id.desc()).limit(1)
    )
    k = kq.scalar_one_or_none()
    return _format_agent(agent, k)


# ── Knowledge Upload & Agent Training ────────────────────────────────────────

@router.post("/api/agents/{agent_id}/documents")
async def upload_agent_knowledge(
    agent_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_database),
):
    """
    Upload and process knowledge document for an agent.
    Extracts text, cleans, chunks, generates embeddings, and saves isolated FAISS index.
    Updates Agent state to READY upon completion.
    """
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    content_bytes = await file.read()
    is_valid, err = validate_file(file.filename, len(content_bytes))
    if not is_valid:
        raise HTTPException(status_code=400, detail=err)

    # Save raw file
    upload_dir = settings.BASE_DIR / "uploads" / f"agent_{agent_id}"
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_path = upload_dir / file.filename

    with open(saved_path, "wb") as f:
        f.write(content_bytes)

    # Record Knowledge row
    ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
    knowledge = Knowledge(
        institute_id=agent.id,
        document_name=file.filename,
        document_type=ext,
        file_path=str(saved_path),
        file_size=len(content_bytes),
        status=KnowledgeStatus.PROCESSING,
        processing_started_at=datetime.now(timezone.utc),
    )
    session.add(knowledge)
    agent.status = AgentStatus.PROCESSING.value
    await session.commit()
    await session.refresh(knowledge)

    try:
        # 1. Extract text
        raw_text = await extract_text(str(saved_path), file.filename)
        if not raw_text.strip():
            raise ValueError("No extractable text found in uploaded document")

        # 2. Chunk text
        knowledge.status = KnowledgeStatus.CHUNKING
        await session.commit()
        chunks = chunk_text(raw_text, source_document=file.filename)
        knowledge.chunks_count = len(chunks)

        # 3. Generate embeddings (pass chunk dicts — embeddings reads c["text"])
        knowledge.status = KnowledgeStatus.EMBEDDING
        await session.commit()
        embeddings = generate_embeddings(chunks)

        # 4. Save to agent-isolated vector store
        vector_store_manager.save_store(agent.id, chunks, embeddings)

        # 5. Mark as READY
        knowledge.status = KnowledgeStatus.READY
        knowledge.processing_completed_at = datetime.now(timezone.utc)
        agent.status = AgentStatus.READY.value
        await session.commit()

        # Reload ORM state after the heavy sync embedding work so attribute
        # access below never triggers implicit lazy IO outside the greenlet.
        await session.refresh(agent)
        await session.refresh(knowledge)

        logger.info("Agent %d knowledge processed successfully: %d chunks", agent.id, len(chunks))

        return {
            "message": "Knowledge document processed successfully",
            "document_name": file.filename,
            "chunks_count": len(chunks),
            "status": "ready",
            "agent": _format_agent(agent, knowledge),
        }

    except Exception as e:
        logger.error("Agent %d document processing failed: %s", agent.id, e)
        try:
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = str(e)
            agent.status = AgentStatus.DRAFT.value
            await session.commit()
        except Exception as db_err:
            logger.error("Failed to persist error state: %s", db_err)
        raise HTTPException(status_code=500, detail=f"Document processing error: {e}")


@router.get("/api/agents/{agent_id}/documents")
async def list_agent_documents(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    """List all knowledge documents for this agent."""
    result = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent_id).order_by(Knowledge.id.desc())
    )
    docs = result.scalars().all()
    return [
        {
            "id": d.id,
            "name": d.document_name,
            "type": d.document_type,
            "size_kb": round(d.file_size / 1024, 1),
            "chunks": d.chunks_count,
            "status": d.status.value,
            "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
        }
        for d in docs
    ]


# ── Publish & Pause Workflow ─────────────────────────────────────────────────

@router.post("/api/agents/{agent_id}/publish")
async def publish_agent(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Publish agent to activate real calling campaigns."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    kq = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent_id, Knowledge.status == KnowledgeStatus.READY)
    )
    k = kq.scalars().first()
    if not k:
        # Fallback: check if agent already has vector store loaded
        if not vector_store_manager.get_store(agent_id).is_ready:
            raise HTTPException(
                status_code=400,
                detail="Knowledge base is not ready. Please upload and process a document before publishing.",
            )

    agent.status = AgentStatus.PUBLISHED.value
    await session.commit()

    current_v = int(_publish_registry.get(agent_id, {}).get("version", "v0").lstrip("v") or 0)
    new_version = f"v{current_v + 1}"
    _publish_registry[agent_id] = {
        "version": new_version,
        "published_at": datetime.now(timezone.utc).isoformat(),
    }

    return {
        "status": "published",
        "version": new_version,
        "message": f"Agent {agent.agent_name or agent.name} is now PUBLISHED and ready for calling campaigns!",
    }


@router.post("/api/agents/{agent_id}/pause")
async def pause_agent(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Pause agent to temporarily halt outbound calling."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent.status = AgentStatus.PAUSED.value
    await session.commit()

    return {
        "status": "paused",
        "message": f"Agent {agent.agent_name or agent.name} has been paused.",
    }


# ── Backward Compatible Settings & REST Chat ─────────────────────────────────

@router.get("/api/agents/{agent_id}/settings")
async def get_agent_settings_compat(agent_id: int, session: AsyncSession = Depends(get_database)):
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    kq = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent_id).order_by(Knowledge.id.desc()).limit(1)
    )
    k = kq.scalar_one_or_none()
    return _format_agent(agent, k)


@router.patch("/api/agents/{agent_id}/settings")
async def update_agent_settings_compat(
    agent_id: int,
    body: AgentUpdateRequest,
    session: AsyncSession = Depends(get_database),
):
    return await update_agent(agent_id, body, session)


class ChatRequest(BaseModel):
    institute_id: int
    message: str
    session_id: Optional[str] = None
    language: Optional[str] = "English"


_chat_sessions: dict = {}


@router.post("/api/chat")
async def text_chat(body: ChatRequest, session: AsyncSession = Depends(get_database)):
    """REST text-chat fallback for testing when WebSocket is not used."""
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    agent = await session.get(Institute, body.institute_id)
    agent_name = agent.agent_name if agent else "Aadhya"
    company_name = agent.name if agent else "Doneswari"
    instructions = agent.instructions if agent else None

    session_id = body.session_id or f"rest_{body.institute_id}"
    history = _chat_sessions.get(session_id, [])

    try:
        from app.rag.retriever import retrieve_context, format_context_for_prompt
        chunks = await retrieve_context(body.message, top_k=4, agent_id=body.institute_id)
        context = format_context_for_prompt(chunks)

        from app.rag.groq_service import stream_chat_fast
        parts = []
        async for token in stream_chat_fast(
            body.message,
            lang=body.language or "English",
            conversation_history=history[-6:],
            context=context,
            agent_name=agent_name,
            company_name=company_name,
            instructions=instructions,
        ):
            parts.append(token)

        response_text = "".join(parts).strip()
        if not response_text:
            response_text = "I don't have that exact information available right now. I can help with what I have, or arrange for a counsellor to contact you."

        history.append({"role": "user", "content": body.message})
        history.append({"role": "assistant", "content": response_text})
        _chat_sessions[session_id] = history[-12:]

        return {
            "response": response_text,
            "session_id": session_id,
            "grounded": bool(context),
        }
    except Exception as e:
        logger.error("REST chat failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Chat error: {e}")
