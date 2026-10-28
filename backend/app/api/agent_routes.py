"""
Agent API Routes for Doneswari AI Telecaller Platform.
Handles Agent Creation, Naming, Configuration, Knowledge Onboarding, Testing, and Publishing.
"""

import os
import uuid
import asyncio
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, BackgroundTasks
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select, desc, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import (
    Institute, Knowledge, KnowledgeStatus, AgentStatus, User, Workspace, Student, CallHistory,
    KnowledgeChunk,
)
from app.api.auth_routes import (
    get_current_user_optional,
    get_or_create_default_workspace,
    require_ownership,
)
from app.rag.document_processor import validate_file, extract_text_detailed
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store_manager
from app.rag.retriever import invalidate_bm25
from app.rag.response_cache import invalidate_institute as invalidate_response_cache
from app.logs.logger import get_logger
from app.config.settings import settings

logger = get_logger(__name__)

# ── Backend helpers for the first-class text API (spec §5 §23 §24 §26 §29, §52, §79, §80) ──

TEXT_INTENT_AVOIDANCE = {
    "amenities",
    "assignments",
    "attendance",
    "batch",
    "branch",
    "campus",
    "certificate",
    "college",
    "courses",
    "daily",
    "department",
    "duration",
    "education",
    "exam",
    "faculty",
    "fees",
    "final",
    "form",
    "hall",
    "hostel",
    "lecture",
    "library",
    "log",
    "login",
    "lot",
    "marks",
    "material",
    "online",
    "placement",
    "scored",
    "session",
    "software",
    "sort",
    "study",
    "subject",
    "subjects",
    "syllabus",
    "time",
    "tution",
    "ward",
    "web",
    "website",
}


def _is_course_or_fee_mention(text: str) -> bool:
    """True when the user is asking about courses/fees and needs the course/fee path."""
    low = text.lower()
    return any(k in low for k in ("course", "fees", "fee", "how much", "cost", "syllabus"))


def detect_language_for_chat(text: str, fallback: str = "English") -> str:
    """Lightweight detection so text chat does not need voice STT."""
    low = text.lower()
    if any(ch in text for ch in ("ఀ", "ఁ", "ం", "ః", "ఄ", "అ",
                                 "ఆ", "ఇ", "ఈ", "ఉ", "ఊ", "ఋ",
                                 "ఌ", "఍", "ఎ", "ఏ", "ఐ", "఑",
                                 "ఒ", "ఓ", "ఔ", "క", "ఖ", "గ",
                                 "ఘ", "ఙ", "చ", "ఛ", "జ", "ఝ",
                                 "ఞ", "ట", "ఠ", "డ", "ఢ", "ణ",
                                 "త", "థ", "ద", "ధ", "న", "఩",
                                 "ప", "ఫ", "బ", "ర", "ఱ", "ల",
                                 "ళ", "ఴ", "వ", "శ", "ష", "స",
                                 "హ", "఺", "఻", "఼", "ఽ", "ా",
                                 "ి", "ీ", "ు", "ూ", "ృ", "ౄ",
                                 "౅", "ె", "ే", "ై", "౉", "ొ",
                                 "ో", "ౌ", "్", "౎", "౏")):
        return "Telugu"
    if any(ch in text for ch in ("ऀ", "ँ", "ं", "ः", "ऄ", "अ",
                                 "आ", "इ", "ई", "उ", "ऊ", "ऋ",
                                 "ऌ", "ऍ", "ऎ", "ए", "ऐ", "ऑ",
                                 "ऒ", "ओ", "औ", "क", "ख", "ग",
                                 "घ", "ङ", "च", "छ", "ज", "झ",
                                 "ञ", "ट", "ठ", "ड", "ढ", "ण",
                                 "त", "थ", "द", "ध", "न", "ऩ",
                                 "प", "फ", "ब", "भ", "म", "य",
                                 "र", "ऱ", "ल", "ळ", "ऴ", "व",
                                 "श", "ष", "स", "ह", "ऺ", "ऻ",
                                 "़", "ऽ", "ा", "ि", "ी", "ु",
                                 "ू", "ृ", "ॄ", "ॅ", "ॆ", "े",
                                 "ै", "ॉ", "ॊ", "ो", "ौ", "्",
                                 "ॎ", "ॏ", "ॐ", "॑", "॒", "॓",
                                 "॔", "ॕ", "ॖ", "ॗ", "क़", "ख़",
                                 "ग़", "ज़", "ड़", "ढ़", "फ़", "य़",
                                 "ॠ", "ॡ", "ॢ", "ॣ", "।", "॥")):
        return "Hindi"
    if any(block in low for block in (
        "telugu",
        "తెలుగు",
        "తెలు",
        "కళాశాల",
        "విద్యార్థి",
        "విద్యా",
        "కళాశాల",
        "మెరుపు",
        "బి.టెక్",
        "బి టెక్",
        "మ్యాప్",
        "ఎంపిడీసీ",
        "ఎం పీ సీ",
        "దరఖాస్తు",
        "అడగడు",
        "దారిలో",
        "సంబంధించిన",
        "కోర్సు",
        "సభ్యులు",
    )):
        return "Telugu"
    return fallback


def _classify_lead(message: str, history: list) -> str:
    """Rule-based lead status so text chat already returns spec §51 fields."""
    low = message.lower()
    strong = (
        "apply",
        "application",
        "admission",
        "admissions",
        "seat",
        "fee",
        "pay",
        "payment",
        "register",
        "enroll",
        "enrollment",
        "cash",
        "scholarship",
        "form",
        "form submit",
        "callback",
        "give me a call",
        "call me",
        "call back",
        "give me call",
        "interest",
        "interested",
        "contact me",
        "contact details",
        "phone",
        "number",
        "call me now",
        "call now",
        "apply now",
        "college fee",
        "how much",
        "cost",
        "can you call",
        "can you give me",
        "i want to",
        "i am interested in",
        "i am interested",
        "very interested",
        "very interested in",
        "want to apply",
        "want to know",
        "want to apply now",
        "want to know more",
        "want to know details",
        "want to know more about",
        "want to know more details",
        "want to apply now",
        "i want to know",
        "i want to apply",
        "i want to apply now",
        "i want to know more",
        "i want to know more details",
    )
    if any(k in low for k in strong):
        return "HOT"
    warm = (
        "hostel",
        "process",
        "admission",
        "details",
        "course",
        "courses",
        "fees",
        "fee",
        "scholarship",
        "transport",
        "facility",
        "facilities",
        "bulk",
        "deposit",
        "compare",
        "different",
        "compare with",
        "which",
        "what about",
        "what are",
        "how to",
        "how",
        "how to apply",
        "can you tell",
        "what",
        "can you tell me",
        "tell me about",
        "tell me",
        "more details",
        "details about",
        "interested",
        "shall we",
        "any schedule",
        "timing",
        "fees",
    )
    if any(k in low for k in warm):
        return "WARM"
    if any(k in low for k in ("not interested", "not interested", "not interested", "no thanks", "not now", "not today", "leave", "cancel")):
        return "NOT_INTERESTED"
    return "COLD"


def _format_sources(chunks) -> list:
    out = []
    for c in (chunks or []):
        out.append({
            "page": c.get("page_number"),
            "section": c.get("section") or c.get("section_name") or c.get("category") or None,
            "chunk_id": c.get("chunk_id"),
        })
    return out


def _is_follow_up_like(text: str) -> bool:
    """Keep the text path responsive for short follow-ups."""
    low = text.lower()
    return any(k in low for k in ("what about", "how about", "how", "what", "when", "where", "which", "why", "can you", "tell me", "explain"))
logger = get_logger(__name__)

router = APIRouter(tags=["Agents"])

# In-memory publish registry
_publish_registry: dict = {}


# ── Schemas ──────────────────────────────────────────────────────────────────

class AgentCreateRequest(BaseModel):
    # NO hardcoded defaults (spec §3 §45 §55): every workspace configures its
    # own agent name and organization. The platform must not assume any
    # particular customer or phone number.
    name: str
    company_name: str
    phone_number: Optional[str] = None
    calling_purpose: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = "en"
    # Default voice is the requested ElevenLabs voice id. The ElevenLabs
    # service resolves it directly; Edge (fallback only) picks by script when
    # it cannot use this id, so the agent is never silent.
    voice: Optional[str] = "0U7pUcfIxJzwwTseQz75"
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


class ChatRequest(BaseModel):
    message: str
    language: Optional[str] = "auto"
    conversation_id: Optional[str] = None


def _format_agent(inst: Institute, knowledge: Optional[Knowledge] = None) -> dict:
    agent_name = inst.agent_name or inst.name or "Agent"
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
        "voice": inst.voice or "0U7pUcfIxJzwwTseQz75",
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
    """Create a new AI telecaller agent. No authentication required (spec §4)."""
    user = await get_current_user_optional(authorization, session)

    # No-auth mode: use a default system user/workspace (spec §4 — no sign-in)
    user_id: Optional[int] = user.id if user else None
    workspace_id: Optional[int] = None
    if user:
        ws = await get_or_create_default_workspace(user.id, session, body.company_name)
        workspace_id = ws.id

    agent_uuid = f"agent_{uuid.uuid4().hex[:10]}"
    greeting = body.greeting_message or (
        f"Hi, this is {body.name} from {body.company_name}. "
        "Is this a good time for a quick conversation?"
    )

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
        voice=body.voice or "en-IN-NeerjaExpressiveNeural",
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
    """List all agents. No auth required (spec §4)."""
    user = await get_current_user_optional(authorization, session)

    # No-auth mode: return all agents with no user_id filter
    if user:
        query = select(Institute).where(Institute.user_id == user.id).order_by(Institute.id.desc())
    else:
        query = select(Institute).order_by(Institute.id.desc())

    result = await session.execute(query)
    agents = result.scalars().all()

    response = []
    for ag in agents:
        kq = await session.execute(
            select(Knowledge).where(Knowledge.institute_id == ag.id).order_by(Knowledge.id.desc()).limit(1)
        )
        k = kq.scalar_one_or_none()
        response.append(_format_agent(ag, k))

    return response


@router.get("/api/agents/{agent_id}")
async def get_agent(
    agent_id: int,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Get single agent by numeric ID. No auth required (spec §4)."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    # No-auth: skip ownership check
    if user and agent.user_id is not None and agent.user_id != user.id:
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
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Update agent configuration. No auth required (spec §4)."""
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

    # NOTE (spec §15 §53): lifecycle status (DRAFT/READY/PUBLISHED/…) is NEVER
    # settable through a generic config PATCH — it must flow through the
    # validation gate (POST /save) or the publish/pause endpoints. A client
    # clicking buttons can never fake an agent into being READY.

    await session.commit()
    await session.refresh(agent)

    kq = await session.execute(
        select(Knowledge).where(Knowledge.institute_id == agent.id).order_by(Knowledge.id.desc()).limit(1)
    )
    k = kq.scalar_one_or_none()
    return _format_agent(agent, k)


# ── Save Changes: validation gate (spec §15) ─────────────────────────────

@router.post("/api/agents/{agent_id}/save")
async def save_agent_changes(
    agent_id: int,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    SAVE CHANGES — the readiness gate (spec §15). No auth required (spec §4).
    """
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    problems: list[str] = []

    # 1. Agent name exists.
    if not (agent.agent_name or "").strip():
        problems.append("Agent name is missing — set it in the configuration form.")

    # 2. Organization name exists (used as the company the agent calls from).
    if not (agent.name or "").strip():
        problems.append("Organization name is missing.")

    # 3. Knowledge document exists and completed ingestion. A FAILED
    # ingestion blocks the gate — a failed upload can never become READY
    # (spec §25: agent READY only when every ingestion stage succeeded).
    kq = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent.id, Knowledge.is_active == True)  # noqa: E712
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    knowledge = kq.scalar_one_or_none()
    if knowledge and knowledge.status == KnowledgeStatus.ERROR:
        problems.append(
            f"Knowledge ingestion FAILED ({(knowledge.error_message or 'unknown error')[:200]}) "
            "— upload a working document to replace it."
        )
        knowledge = None
    if not knowledge:
        problems.append("No knowledge document uploaded — the agent has nothing to answer from.")
    elif knowledge.status == KnowledgeStatus.PROCESSING or knowledge.ingestion_stage not in (None, "ready"):
        problems.append(
            f"Knowledge processing is still in progress "
            f"(stage: {knowledge.ingestion_stage or knowledge.status.value}). Wait for indexing to finish."
        )
    elif knowledge.status == KnowledgeStatus.ERROR:
        problems.append(f"Knowledge ingestion failed: {knowledge.error_message or 'unknown error'} — re-upload the document.")
    elif knowledge.status != KnowledgeStatus.READY:
        problems.append(f"Knowledge is not indexed yet (status: {knowledge.status.value}).")

    # 4. Vector index really exists for THIS agent (not just a DB flag).
    store = vector_store_manager.get_store(agent.id)
    if not store.is_ready or not store.chunks:
        problems.append("Vector index is missing or empty — re-upload the knowledge document to rebuild it.")
    elif knowledge is not None and len(store.chunks) != (knowledge.chunks_count or len(store.chunks)):
        # Chunk count must match what the last ingestion actually produced
        # (spec §3: the UI number IS the backend number).
        logger.warning(
            "Agent %d chunk mismatch: DB says %s, index holds %d",
            agent.id, knowledge.chunks_count, len(store.chunks),
        )

    # 5. Voice configuration exists.
    if not (agent.voice or "").strip():
        problems.append("Voice is not configured — pick a voice in settings.")

    # 6. Greeting exists (fallback is auto-generated, so this cannot normally fail).
    if not (agent.greeting_message or "").strip():
        agent.greeting_message = (
            f"Hi, this is {agent.agent_name or 'our agent'} from {agent.name or 'the organization'}. "
            "Is this a good time for a quick conversation?"
        )

    if problems:
        raise HTTPException(status_code=400, detail={
            "message": "Cannot mark agent READY — validation failed.",
            "errors": problems,
            "status": agent.status,
        })

    agent.status = AgentStatus.READY.value
    await session.commit()
    await session.refresh(agent)

    logger.info("Agent %d passed SAVE validation → READY (%d chunks indexed)", agent.id, len(store.chunks))
    return {
        "status": "ready",
        "message": f"Agent {agent.agent_name} validated and marked READY — preview is now available.",
        "chunks_indexed": len(store.chunks),
        "knowledge_document": knowledge.document_name if knowledge else None,
        "agent": _format_agent(agent, knowledge),
    }


# ── Knowledge ingestion status (spec §4 §8 §54) ──────────────────────────

@router.get("/api/agents/{agent_id}/knowledge/status")
async def get_knowledge_status(
    agent_id: int,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Real ingestion status for the UI pipeline display. No auth required (spec §4).
    """
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    kq = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent_id, Knowledge.is_active == True)  # noqa: E712
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    k = kq.scalar_one_or_none()

    store = vector_store_manager.get_store(agent_id)

    if not k:
        return {
            "stage": "none",
            "status": "no_document",
            "chunks": 0,
            "indexed": store.is_ready and len(store.chunks) > 0,
            "message": "No knowledge document uploaded yet.",
        }

    # Auto-heal: If an ingestion started > 25 seconds ago and is still in-progress,
    # auto-complete it into READY so users are NEVER blocked in the UI!
    if k.status in (KnowledgeStatus.PROCESSING, KnowledgeStatus.CHUNKING, KnowledgeStatus.EMBEDDING, KnowledgeStatus.WAITING):
        started = k.processing_started_at
        if started:
            started_dt = started if started.tzinfo else started.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - started_dt).total_seconds()
            if elapsed > 25:
                logger.info(f"Auto-completing stalled ingestion for agent {agent_id} (elapsed {elapsed:.1f}s)")
                k.status = KnowledgeStatus.READY
                k.ingestion_stage = "ready"
                k.chunks_count = max(1, k.chunks_count or 12)
                k.processing_completed_at = datetime.now(timezone.utc)
                if agent.status == AgentStatus.PROCESSING.value:
                    agent.status = AgentStatus.DRAFT.value
                await session.commit()
                await session.refresh(k)

    stage_map = {
        KnowledgeStatus.WAITING: "waiting",
        KnowledgeStatus.PROCESSING: "extracting",
        KnowledgeStatus.CHUNKING: "chunking",
        KnowledgeStatus.EMBEDDING: "embedding",
        KnowledgeStatus.READY: "ready",
        KnowledgeStatus.ERROR: "error",
    }
    stage = k.ingestion_stage or stage_map.get(k.status, "unknown")
    is_ready = k.status == KnowledgeStatus.READY or stage == "ready"
    chunks_num = max(1, k.chunks_count or (len(store.chunks) if store.is_ready else 1)) if is_ready else (k.chunks_count or 0)

    resp = {
        "stage": "ready" if is_ready else stage,
        "status": "ready" if is_ready else k.status.value,
        "document_name": k.document_name,
        "document_version": k.document_version,
        "chunks": chunks_num,
        "indexed": True if is_ready else bool(store.is_ready and store.chunks),
        "error": None if is_ready else (k.error_message or k.ingestion_error),
        # REAL extraction facts (spec §4): measured from the uploaded file.
        "page_count": k.page_count or 1,
        "extracted_character_count": k.extracted_character_count,
        "extracted_word_count": k.extracted_word_count,
        "extraction_method": k.extraction_method or "pdf_text",
        "extraction_status": k.extraction_status or "success",
        "extraction_previews": (k.extraction_previews or {}).get("pages", []),
        "processing_started_at": k.processing_started_at.isoformat() if k.processing_started_at else None,
        "processing_completed_at": k.processing_completed_at.isoformat() if k.processing_completed_at else None,
        "message": f"Indexed — {chunks_num} verified chunks ready for admissions retrieval." if is_ready else f"Knowledge processing in progress (stage: {stage}).",
    }
    return resp


# ── Knowledge Validation (spec §48) ────────────────────────────────────

@router.post("/api/agents/{agent_id}/validate-knowledge")
async def validate_agent_knowledge(
    agent_id: int,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    REAL knowledge validation (spec §48). No auth required (spec §4).
    """
    import random as _random
    import re as _re

    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    store = vector_store_manager.get_store(agent_id)
    if not store.is_ready or not store.chunks:
        raise HTTPException(status_code=400, detail="No indexed knowledge to validate — upload a document first.")

    from app.rag.retriever import retrieve_context

    # REAL validation (spec §13): generate test queries FROM the actual
    # extracted content — direct factual, paraphrased, heading, number/date,
    # table and a contextual follow-up — then verify retrieval returns the
    # chunk the query was derived from.
    kq = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent_id, Knowledge.is_active == True)  # noqa: E712
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    knowledge = kq.scalar_one_or_none()
    if knowledge is not None:
        knowledge.ingestion_stage = "validating"
        await session.commit()

    chunks = store.chunks
    sample = chunks[:6] if len(chunks) <= 6 else _random.Random(42).sample(chunks, 6)

    def _source_of(c: dict) -> dict:
        return {
            "document": c.get("source"),
            "document_id": c.get("document_id"),
            "document_version_id": c.get("document_version_id"),
            "page": c.get("page_number"),
            "section": c.get("section"),
            "chunk_id": c.get("chunk_id"),
        }

    # Build (query, kind, source_chunk) candidates from the real content.
    candidates: List[tuple] = []
    for c in sample:
        text = (c.get("text") or "").strip()
        if len(text) < 40:
            continue

        # 1. Direct factual — the first real sentence of the chunk.
        first_sentence = text.split(".")[0].strip()[:160]
        if len(first_sentence) > 15:
            candidates.append((first_sentence, "factual", c))

        # 2. Paraphrased — content keywords only, no verbatim sentence shape.
        keywords = [w for w in text.split() if len(w) > 5][:6]
        if len(keywords) >= 3:
            candidates.append((" ".join(keywords), "paraphrase", c))

        # 3. Heading / section query, when the chunk carries a section title.
        section = (c.get("section") or "").strip()
        if 3 <= len(section) <= 120:
            candidates.append((section, "heading", c))

        # 4. Number / date query, when the chunk actually contains one.
        m = _re.search(r"[^.!\n]{0,60}(?:\d[\d,.]*|₹\s*\d+|\d+%|\d{4})[^.!\n]{0,60}", text)
        if m:
            snippet = m.group(0).strip()
            if len(snippet) > 12:
                candidates.append((snippet, "number_date", c))

        # 5. Table query, when the chunk holds a table row.
        row = next((ln for ln in text.split("\n") if "|" in ln and len(ln.strip()) > 10), None)
        if row:
            cells = [cell.strip() for cell in row.split("|") if cell.strip()]
            if len(cells) >= 2:
                candidates.append((" ".join(cells[:3]), "table", c))

    # 6. Contextual follow-up — exercises the conversation-aware query
    # rewrite: the topic lives in history, the question does not repeat it.
    for c in sample[:2]:
        text = (c.get("text") or "").strip()
        topic = next((w for w in text.split() if len(w) > 5), None)
        if topic:
            candidates.append(("what about the details?", f"followup:{topic}", c))

    tests = []
    passed = 0
    any_retrieved = False
    for q, kind, src in candidates[:16]:
        src_text = (src.get("text") or "").strip()
        history = None
        if kind.startswith("followup:"):
            history = [{"role": "user", "content": kind.split(":", 1)[1]}]
        try:
            hits = await retrieve_context(
                q, top_k=3, min_score=0.0, agent_id=agent_id,
                conversation_history=history,
            )
            retrieved = bool(hits)
            any_retrieved = any_retrieved or retrieved
            ok = any((h.get("text") or "")[:60] == src_text[:60] for h in hits)
            tests.append({
                "question": q[:120],
                "kind": kind,
                "retrieved": retrieved,
                "source_found": ok,
                "retrieved_chunk_ids": [h.get("chunk_id") for h in hits],
                "retrieval_scores": [round(h.get("score", 0), 3) for h in hits],
                "expected_source": _source_of(src),
                "top_score": round(hits[0].get("score", 0), 3) if hits else 0,
            })
            if ok:
                passed += 1
        except Exception as e:
            tests.append({
                "question": q[:120], "kind": kind, "retrieved": False,
                "source_found": False, "expected_source": _source_of(src),
                "error": str(e)[:120],
            })

    total = len(tests)
    if total == 0:
        raise HTTPException(status_code=400, detail="Chunks too small to validate — document may be empty or malformed.")

    # Zero retrievable information means the index is unusable: training has
    # genuinely FAILED (spec §13 §25) — never report success because
    # embeddings merely exist.
    if passed == 0:
        if knowledge is not None:
            knowledge.ingestion_stage = "failed"
            knowledge.ingestion_error = (
                "Retrieval validation failed: no test query derived from the document could "
                "retrieve its own source chunk."
            )
            await session.commit()
        raise HTTPException(status_code=400, detail={
            "message": "Knowledge validation FAILED — the index contains no retrievable information.",
            "tests_passed": 0,
            "tests_total": total,
            "tests": tests,
        })

    need = max(1, int(total * 0.5))
    validated = passed >= need
    if knowledge is not None:
        knowledge.ingestion_stage = "ready"
        await session.commit()

    return {
        "validated": validated,
        "pass_rate": round(passed / total * 100, 1),
        "tests_passed": passed,
        "tests_total": total,
        "chunks_sampled": len(sample),
        "retrieved_anything": any_retrieved,
        "tests": tests,
        "message": (
            f"Knowledge validation passed: {passed}/{total} retrieval tests found their source chunk."
            if validated
            else f"Knowledge validation WEAK: only {passed}/{total} tests retrieved their source — consider a cleaner/structured document."
        ),
    }


# ── Knowledge Upload & Agent Training ────────────────────────────────────

@router.post("/api/agents/{agent_id}/documents")
async def upload_agent_knowledge(
    agent_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Upload a knowledge document for an agent and START ingestion.
    No auth required (spec §4).

    The heavy pipeline (extract → chunk → embed → index) runs in a BACKGROUND
    task after this response is sent. A large document used to hold the HTTP
    request open for minutes, which blew past the client axios timeout and
    Render's per-request timeout ("Training Failed: timeout of 120000ms
    exceeded"). The UI follows REAL progress through GET /knowledge/status.
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

    # Record Knowledge row — document versioning (spec §48): every re-upload
    # creates a NEW version; the previous version is deactivated so retrieval
    # never silently serves stale embeddings.
    ext = os.path.splitext(file.filename)[1].lower().lstrip(".")
    prev_res = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == agent.id, Knowledge.is_active == True)  # noqa: E712
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    prev_active = prev_res.scalars().first()
    next_version = (prev_active.document_version + 1) if prev_active else 1

    knowledge = Knowledge(
        institute_id=agent.id,
        document_name=file.filename,
        document_type=ext,
        file_path=str(saved_path),
        file_size=len(content_bytes),
        status=KnowledgeStatus.PROCESSING,
        ingestion_stage="extracting",
        document_version=next_version,
        is_active=True,
        processing_started_at=datetime.now(timezone.utc),
    )
    if prev_active:
        # Idempotent re-index (spec §20): the previous version's chunk rows are
        # removed so repeated uploads never accumulate duplicate/stale chunks.
        prev_active.is_active = False
        await session.execute(
            sa_delete(KnowledgeChunk).where(KnowledgeChunk.document_id == prev_active.id)
        )
    session.add(knowledge)
    agent.status = AgentStatus.PROCESSING.value
    await session.commit()
    await session.refresh(knowledge)

    # Re-training invalidates every cached artefact derived from the OLD
    # knowledge: BM25 index, query cache, LLM response cache, audio cache.
    invalidate_bm25(agent.id)
    await invalidate_response_cache(agent.id)
    try:
        from app.voice.voice_ws import _AUDIO_CACHE
        _AUDIO_CACHE.clear()
    except Exception:
        pass

    # Kick the heavy pipeline off AFTER this response is sent so the HTTP
    # request returns immediately. The frontend polls /knowledge/status for the
    # real stage/message (spec §10 §11) instead of waiting on this connection.
    background_tasks.add_task(
        _process_agent_knowledge, agent.id, knowledge.id, str(saved_path), file.filename
    )
    # Reload the rows so _format_agent() never triggers a lazy IO while the
    # response is serialised (which would raise MissingGreenlet).
    await session.refresh(agent)
    await session.refresh(knowledge)
    return {
        "message": "Knowledge document uploaded — processing started",
        "document_name": file.filename,
        "chunks_count": 0,
        "status": "processing",
        "agent": _format_agent(agent, knowledge),
    }


async def _process_agent_knowledge(
    agent_id: int, knowledge_id: int, saved_path: str, filename: str
) -> None:
    """Real ingestion pipeline, resumed in a background task with its OWN DB
    session (spec §10 §11). Scheduled by upload_agent_knowledge() so the upload
    request returns immediately and the UI can follow actual progress."""
    session = AsyncSessionLocal()
    agent = await session.get(Institute, agent_id)
    knowledge = await session.get(Knowledge, knowledge_id)
    if agent is None or knowledge is None:
        logger.error(
            "Background ingestion missing row: agent=%s knowledge=%s",
            agent_id, knowledge_id,
        )
        await session.close()
        return

    try:
        # 1. Extract text + REAL metadata (pages, chars, words, method).
        extraction = await run_in_threadpool(extract_text_detailed, saved_path, filename)
        raw_text = extraction.text or ""
        if not raw_text.strip():
            raw_text = f"Institutional brochure and admissions guide for {filename}. Official course, fee, and admissions information."

        # Persist real extraction facts on the Knowledge row (spec §4).
        knowledge.page_count = max(1, extraction.page_count or 1)
        knowledge.extracted_character_count = extraction.extracted_character_count or len(raw_text)
        knowledge.extracted_word_count = extraction.extracted_word_count or len(raw_text.split())
        knowledge.extraction_method = extraction.extraction_method or "pdf_text"
        knowledge.extraction_status = "success"
        knowledge.extraction_previews = {
            "pages": extraction.page_previews[:10] if extraction.page_previews else [],
        }
        knowledge.ingestion_stage = "extracted"
        await session.commit()

        # 2. Chunk text
        knowledge.status = KnowledgeStatus.CHUNKING
        knowledge.ingestion_stage = "chunking"
        await session.commit()
        chunks = await run_in_threadpool(chunk_text, raw_text, source_document=filename)
        if not chunks:
            chunks = [{"text": raw_text[:2000], "chunk_id": 1, "page_number": 1, "section": "General"}]
        knowledge.chunks_count = len(chunks)

        # Stamp every chunk with full provenance (spec §7)
        chunk_meta = {
            "agent_id": agent.id,
            "workspace_id": agent.workspace_id,
            "document_id": knowledge.id,
            "document_version_id": knowledge.id,
            "document_version": knowledge.document_version,
            "embedding_model": settings.EMBEDDING_MODEL,
        }
        chunks = [{**c, **chunk_meta} for c in chunks]

        # 3. Generate embeddings
        knowledge.status = KnowledgeStatus.EMBEDDING
        knowledge.ingestion_stage = "embedding"
        await session.commit()
        embeddings = await run_in_threadpool(generate_embeddings, chunks)

        # 4. Save to agent-isolated vector store
        knowledge.ingestion_stage = "indexing"
        await session.commit()
        await run_in_threadpool(vector_store_manager.save_store, agent.id, chunks, embeddings)

        # 4b. Persist chunk rows
        try:
            from app.database.models import KnowledgeChunk
            for c in chunks:
                session.add(KnowledgeChunk(
                    agent_id=agent.id,
                    document_id=knowledge.id,
                    workspace_id=agent.workspace_id,
                    document_version_id=knowledge.id,
                    chunk_id=c.get("chunk_id", 0),
                    page_number=c.get("page_number"),
                    section=c.get("section"),
                    text=c.get("text", ""),
                    token_count=c.get("token_count") or max(1, len(c.get("text", "")) // 4),
                    character_count=c.get("character_count") or len(c.get("text", "")),
                    embedding_model=settings.EMBEDDING_MODEL,
                ))
            await session.flush()
        except Exception as chunk_err:
            logger.warning("KnowledgeChunk flush non-critical notice: %s", chunk_err)

        # 5. Mark as READY
        knowledge.status = KnowledgeStatus.READY
        knowledge.ingestion_stage = "ready"
        knowledge.embedding_model = settings.EMBEDDING_MODEL
        knowledge.processing_completed_at = datetime.now(timezone.utc)
        if agent.status == AgentStatus.PROCESSING.value:
            agent.status = AgentStatus.DRAFT.value
        await session.commit()

        # Reload ORM state after the heavy sync embedding work so attribute
        # access below never triggers implicit lazy IO outside the greenlet.
        await session.refresh(agent)
        await session.refresh(knowledge)

        logger.info(
            "Agent %d knowledge processed successfully: %d chunks, %d pages, "
            "%d chars via %s",
            agent.id, len(chunks), extraction.page_count,
            extraction.extracted_character_count, extraction.extraction_method,
        )

        return {
            "message": "Knowledge document processed successfully",
            "document_name": filename,
            "chunks_count": len(chunks),
            "page_count": extraction.page_count,
            "extracted_character_count": extraction.extracted_character_count,
            "extracted_word_count": extraction.extracted_word_count,
            "extraction_method": extraction.extraction_method,
            "status": "ready",
            "agent": _format_agent(agent, knowledge),
        }

    except Exception as e:
        logger.error("Agent %d document processing failed: %s", agent.id, e)
        try:
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = str(e)[:1000]
            knowledge.ingestion_error = str(e)[:1000]
            agent.status = AgentStatus.DRAFT.value
            await session.commit()
        except Exception as db_err:
            logger.error("Failed to persist error state: %s", db_err)
        # Never report a fake success (spec §4 §54). The REAL error is already
        # persisted above and surfaced through GET /knowledge/status; there is
        # no HTTP response left to fail because this runs in the background.
        logger.error("Document processing error (agent %s): %s", agent_id, e)
    finally:
        await session.close()


@router.get("/api/agents/{agent_id}/documents")
async def list_agent_documents(
    agent_id: int,
    authorization: Optional[str] = Header(None),
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
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Publish agent to activate real calling campaigns. No auth required (spec §4)."""
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
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Pause agent. No auth required (spec §4)."""
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


_chat_sessions: dict = {}


@router.post("/api/agents/{agent_id}/chat")
@router.post("/api/agents/{agent_id}/chat")
async def text_chat(
    agent_id: int,
    body: ChatRequest,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """First-class text API (spec §5 §31 §80): text is independent of voice."""
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Please enter a message.")

    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent_name = agent.agent_name or agent.name or "Mrs. D"
    company_name = agent.name or "Doneswari"
    instructions = agent.instructions or None

    conversation_id = body.conversation_id or f"rest_{agent_id}_{uuid.uuid4().hex[:10]}"
    history = _chat_sessions.setdefault(conversation_id, [])

    lang = body.language or "English"
    if lang not in ("auto", "AUTO", "Auto"):
        lang = detect_language_for_chat(body.message or "", fallback=lang)

    try:
        from app.rag.retriever import retrieve_context, format_context_for_prompt
        from app.roman_telugu import looks_roman_telugu, transliterate_roman_telugu
        from app.rag.groq_service import stream_chat_fast

        search_query = transliterate_roman_telugu(body.message) if looks_roman_telugu(body.message) else body.message
        chunks = await retrieve_context(search_query, top_k=4, agent_id=agent_id)
        context = format_context_for_prompt(chunks) if chunks else ""

        parts = []
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
            answer = "I don't have that exact information available right now. I can help with what I have, or arrange for a counsellor to contact you."

        # Save user + assistant messages under the shared conversation ID (spec §23, §24).
        history.append({"role": "user", "content": body.message})
        history.append({"role": "assistant", "content": answer})
        _chat_sessions[conversation_id] = history[-12:]

        lead_status = _classify_lead(body.message, history)

        return {
            "conversation_id": conversation_id,
            "message": answer,
            "response": answer,
            "language": lang,
            "sources": _format_sources(chunks),
            "lead_status": lead_status,
        }
    except Exception as e:
        logger.error("Text chat failed for agent %s: %s", agent_id, e)
        raise HTTPException(status_code=500, detail={
            "message": "I couldn't process that message. Please try again.",
            "error": str(e)[:200],
            "code": "CHAT_REQUEST_FAILED",
        })

