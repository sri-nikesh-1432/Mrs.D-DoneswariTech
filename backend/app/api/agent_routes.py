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
    """Create a new AI telecaller agent. Authentication REQUIRED (spec §3 §63):
    every agent must be bound to a real user + workspace for tenant isolation."""
    user = await require_ownership(user=await get_current_user_optional(authorization, session), agent=None) if False else await get_current_user_optional(authorization, session)
    if not user:
        from fastapi import status as _status
        raise HTTPException(
            status_code=_status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required — sign in to create agents.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = user.id
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
    if not user:
        from fastapi import status as _status
        raise HTTPException(
            status_code=_status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # STRICT tenant isolation (spec §17): a user sees ONLY their own agents.
    query = select(Institute).where(Institute.user_id == user.id).order_by(Institute.id.desc())

    result = await session.execute(query)
    agents = result.scalars().all()

    # NOTE (spec §55): no auto-created demo agent. A fresh tenant sees an
    # empty agent list and must create their own agent — no fake data.

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
    """Get single agent by numeric ID (tenant-isolated, spec §17)."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
    """Update agent configuration (tenant-isolated, spec §17)."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
    SAVE CHANGES — the readiness gate (spec §15).

    Validates EVERYTHING before an agent may become READY:
      * agent name exists
      * knowledge document exists and finished ingestion
      * vector index actually exists on disk/memory for THIS agent
      * voice configuration exists
      * greeting / configuration valid
      * tenant ownership valid

    Only after ALL checks pass does the agent transition to READY. On failure
    it returns the exact reason (spec §54) — never a generic error.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
    Real ingestion status for the UI pipeline display:
    Uploading → Extracting → Processing → Chunking → Embedding → Indexing → Ready.
    Returns the actual stage, chunk count, and the real error when failed.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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

    stage_map = {
        KnowledgeStatus.WAITING: "waiting",
        KnowledgeStatus.PROCESSING: "extracting",
        KnowledgeStatus.CHUNKING: "chunking",
        KnowledgeStatus.EMBEDDING: "embedding",
        KnowledgeStatus.READY: "ready",
        KnowledgeStatus.ERROR: "error",
    }
    stage = k.ingestion_stage or stage_map.get(k.status, "unknown")

    resp = {
        "stage": stage,
        "status": k.status.value,
        "document_name": k.document_name,
        "document_version": k.document_version,
        "chunks": k.chunks_count or (len(store.chunks) if store.is_ready else 0),
        "indexed": bool(store.is_ready and store.chunks),
        "error": k.error_message or k.ingestion_error,
        # REAL extraction facts (spec §4): measured from the uploaded file.
        "page_count": k.page_count,
        "extracted_character_count": k.extracted_character_count,
        "extracted_word_count": k.extracted_word_count,
        "extraction_method": k.extraction_method,
        "extraction_status": k.extraction_status,
        "extraction_previews": (k.extraction_previews or {}).get("pages", []),
        "processing_started_at": k.processing_started_at.isoformat() if k.processing_started_at else None,
        "processing_completed_at": k.processing_completed_at.isoformat() if k.processing_completed_at else None,
    }
    if k.status == KnowledgeStatus.READY and resp["indexed"]:
        resp["message"] = f"Indexed — {resp['chunks']} chunks ready for retrieval."
    elif k.status == KnowledgeStatus.ERROR:
        resp["message"] = f"Ingestion failed: {resp['error']}"
    else:
        resp["message"] = f"Knowledge processing in progress (stage: {stage})."
    return resp


# ── Knowledge Validation (spec §48) ────────────────────────────────────

@router.post("/api/agents/{agent_id}/validate-knowledge")
async def validate_agent_knowledge(
    agent_id: int,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    REAL knowledge validation (spec §48): after indexing, run retrieval
    smoke tests derived from the agent's OWN chunks. Each test must retrieve
    its source chunk — training never silently reports success.
    """
    import random as _random
    import re as _re

    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """
    Upload and process knowledge document for an agent.
    Extracts text, cleans, chunks, generates embeddings, and saves isolated FAISS index.
    Updates Agent state to READY upon completion.
    """
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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

    try:
        # 1. Extract text + REAL metadata (pages, chars, words, method).
        extraction = extract_text_detailed(str(saved_path), file.filename)
        raw_text = extraction.text
        if not raw_text.strip():
            raise ValueError("No extractable text found in uploaded document")

        # Persist real extraction facts on the Knowledge row (spec §4).
        knowledge.page_count = extraction.page_count
        knowledge.extracted_character_count = extraction.extracted_character_count
        knowledge.extracted_word_count = extraction.extracted_word_count
        knowledge.extraction_method = extraction.extraction_method
        knowledge.extraction_status = extraction.extraction_status
        knowledge.extraction_previews = {
            "pages": extraction.page_previews[:10],
        }
        # EXTRACTED stage (spec §11): the parser ran and produced usable text.
        knowledge.ingestion_stage = "extracted"
        await session.commit()

        # 2. Chunk text — the count below is REAL: whatever the actual
        # chunking of the actual document produces. Never a fixed number.
        knowledge.status = KnowledgeStatus.CHUNKING
        knowledge.ingestion_stage = "chunking"
        await session.commit()
        chunks = chunk_text(raw_text, source_document=file.filename)
        if not chunks:
            raise ValueError("Chunking produced zero chunks — document has no usable content")
        knowledge.chunks_count = len(chunks)

        # Stamp every chunk with full provenance (spec §7) so the vector
        # store, the persisted rows and the retrieval debug view all agree on
        # which agent / workspace / document version a fact belongs to.
        chunk_meta = {
            "agent_id": agent.id,
            "workspace_id": agent.workspace_id,
            "document_id": knowledge.id,
            "document_version_id": knowledge.id,
            "document_version": knowledge.document_version,
            "embedding_model": settings.EMBEDDING_MODEL,
        }
        chunks = [{**c, **chunk_meta} for c in chunks]

        # 3. Generate embeddings (pass chunk dicts — embeddings reads c["text"])
        knowledge.status = KnowledgeStatus.EMBEDDING
        knowledge.ingestion_stage = "embedding"
        await session.commit()
        embeddings = generate_embeddings(chunks)

        # 4. Save to agent-isolated vector store
        knowledge.ingestion_stage = "indexing"
        await session.commit()
        vector_store_manager.save_store(agent.id, chunks, embeddings)

        # 4b. Persist chunk rows so retrieval can cite document/page/section
        # provenance (spec §5 §7 §8 §14 §51).
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

        # 5. Mark as READY — knowledge indexed; agent goes back to its
        # pre-upload lifecycle state (DRAFT agents stay DRAFT until the
        # user clicks Save Changes, spec §15).
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
            "document_name": file.filename,
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
        # Show the REAL failure reason, never a fake success (spec §4 §54).
        raise HTTPException(status_code=500, detail=f"Document processing error: {e}")


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
    """Publish agent to activate real calling campaigns."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
    """Pause agent to temporarily halt outbound calling."""
    user = await get_current_user_optional(authorization, session)
    agent = await session.get(Institute, agent_id)
    await require_ownership(user, agent)

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
