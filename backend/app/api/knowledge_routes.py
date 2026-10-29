"""
Knowledge API Routes - Handle document upload and knowledge base operations.
RAG is a hidden internal engine — the user only sees "Knowledge Ready".
"""

import uuid
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sa_delete
from typing import Optional
from datetime import datetime, timezone
import asyncio

from app.database.connection import get_database
from app.database.models import Institute, Knowledge, KnowledgeStatus, KnowledgeChunk
from app.config.settings import settings
from app.uploads.document_service import DocumentService
from app.rag.document_processor import extract_text_detailed
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store_manager
from app.rag.retriever import invalidate_bm25
from app.rag.response_cache import invalidate_institute as invalidate_response_cache
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


@router.post("/upload")
async def upload_knowledge(
    institute_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_database),
    background_tasks: BackgroundTasks = None,
):
    """
    Upload institute knowledge document.
    Supports: PDF, DOCX, TXT, CSV

    The heavy pipeline (extract → chunk → embed → index) runs in a BACKGROUND
    task after this response is sent. A large document used to hold the HTTP
    request open for minutes, which blew past the client axios timeout and
    Render's per-request timeout ("Training Failed: timeout of 120000ms").
    The UI follows REAL progress through GET /knowledge/status.
    """
    try:
        # If no institute_id provided, create a default institute
        if not institute_id:
            institute = Institute(
                institute_id=f"inst_{uuid.uuid4().hex[:12]}",
                name="Default Institute",
                phone_number="+910000000000"
            )
            session.add(institute)
            await session.commit()
            await session.refresh(institute)
            institute_id = institute.id
            logger.info(f"Created default institute {institute_id} for knowledge upload")

        # Get institute
        result = await session.execute(
            select(Institute).where(Institute.id == institute_id)
        )
        institute = result.scalar_one_or_none()

        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")

        # Read file content
        file_content = await file.read()

        # Validate file
        document_service = DocumentService()
        is_valid, error_message = await document_service.validate_file(file_content, file.filename)

        if not is_valid:
            raise HTTPException(status_code=400, detail=error_message)

        # Save file
        file_path = await document_service.save_file(file_content, file.filename)

        # Create knowledge record
        knowledge = Knowledge(
            institute_id=institute_id,
            document_name=file.filename,
            document_type=file.content_type,
            file_path=str(file_path),
            file_size=len(file_content),
            status=KnowledgeStatus.PROCESSING
        )
        session.add(knowledge)
        await session.commit()
        await session.refresh(knowledge)

        # Start the REAL ingestion pipeline in the background so this request
        # returns immediately. The client times out waiting for the synchronous
        # process_document() call below.
        background_tasks.add_task(
            process_document_background, knowledge.id, file_path
        )

        logger.info(f"Document upload initiated for {file.filename}, processing in background")

        # Return the same shape the new agent document endpoint returns: the
        # request itself is done; progress is tracked by /knowledge/status.
        return {
            "message": "Knowledge document uploaded — processing started",
            "document_name": file.filename,
            "knowledge_id": knowledge.id,
            "institute_id": institute_id,
            "institute_name": institute.name,
            "chunks_count": 0,
            "status": "processing",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading knowledge: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def process_document_background(knowledge_id: int, file_path):
    """Process document in background task."""
    from app.database.connection import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        from app.database.models import Knowledge
        result = await session.execute(
            select(Knowledge).where(Knowledge.id == knowledge_id)
        )
        knowledge = result.scalar_one_or_none()

        if not knowledge:
            logger.error(f"Knowledge {knowledge_id} not found for background processing")
            return

        await process_document(session, knowledge, file_path)


async def process_document(session: AsyncSession, knowledge: Knowledge, file_path):
    """Process document: extract text, chunk, embed, and build vector store (optimized for speed)."""
    try:
        logger.info(f"=== RAG PIPELINE START: Processing document {knowledge.document_name} ===")

        # IMPORTANT: agent-isolated vector store (spec §2 §9). Every rebuild
        # targets THIS agent's store only — never a shared/global store.
        agent_store = vector_store_manager.get_store(knowledge.institute_id)
        logger.info(f"Rebuilding isolated vector store for agent {knowledge.institute_id}...")

        # Update status to processing
        knowledge.status = KnowledgeStatus.PROCESSING
        knowledge.processing_started_at = datetime.now(timezone.utc)
        await session.commit()

        # Extract text + REAL metadata
        logger.info("Extracting text...")
        extraction = extract_text_detailed(str(file_path), knowledge.document_name)
        text = extraction.text

        if not text or not text.strip():
            logger.error("Extracted text is empty")
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = "Extracted text is empty"
            await session.commit()
            return

        logger.info(f"Extracted {len(text)} characters")

        # Persist real extraction facts (spec §4)
        knowledge.page_count = extraction.page_count
        knowledge.extracted_character_count = extraction.extracted_character_count
        knowledge.extracted_word_count = extraction.extracted_word_count
        knowledge.extraction_method = extraction.extraction_method
        knowledge.extraction_status = extraction.extraction_status
        knowledge.extraction_previews = {"pages": extraction.page_previews[:10]}
        await session.commit()

        # Idempotent re-index: clear this agent's previous chunk rows + caches
        await session.execute(
            sa_delete(KnowledgeChunk).where(KnowledgeChunk.agent_id == knowledge.institute_id)
        )
        invalidate_bm25(knowledge.institute_id)
        await invalidate_response_cache(knowledge.institute_id)

        # EXTRACTED stage (spec §11): the parser produced usable text.
        knowledge.ingestion_stage = "extracted"
        await session.commit()

        # Chunk text — count is REAL (whatever the content produces)
        logger.info("Chunking text...")
        knowledge.status = KnowledgeStatus.CHUNKING
        knowledge.ingestion_stage = "chunking"
        await session.commit()
        chunks = chunk_text(text, source_document=knowledge.document_name)

        if not chunks or len(chunks) == 0:
            logger.error("No chunks generated")
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.ingestion_stage = "failed"
            knowledge.error_message = "No chunks generated from text"
            knowledge.ingestion_error = "Chunking produced zero chunks — document has no usable content"
            await session.commit()
            raise HTTPException(status_code=400, detail="Chunking produced zero chunks — document has no usable content")

        logger.info(f"Generated {len(chunks)} chunks")

        # Stamp full provenance on every chunk (spec §7).
        agent_row = await session.get(Institute, knowledge.institute_id)
        for c in chunks:
            c["agent_id"] = knowledge.institute_id
            c["workspace_id"] = getattr(agent_row, "workspace_id", None)
            c["document_id"] = knowledge.id
            c["document_version_id"] = knowledge.id
            c["embedding_model"] = settings.EMBEDDING_MODEL

        # Update status to embedding
        knowledge.status = KnowledgeStatus.EMBEDDING
        knowledge.ingestion_stage = "embedding"
        await session.commit()

        # Generate embeddings (simplified - no quality gate for speed)
        logger.info("Generating embeddings...")
        embeddings = generate_embeddings(chunks)

        logger.info(f"Generated {embeddings.shape[0]} embeddings")

        # Build the AGENT-SCOPED vector store (spec §9)
        logger.info("Building vector store...")
        knowledge.ingestion_stage = "indexing"
        await session.commit()
        agent_store.build_index(chunks, embeddings)

        logger.info(f"Vector store ready with {len(agent_store.chunks)} chunks")

        # Persist to the standard agent path so restarts reload THIS agent's index
        save_path = settings.BASE_DIR / "knowledge" / f"agent_{knowledge.institute_id}" / "index"
        agent_store.save(str(save_path))
        logger.info(f"Vector store saved to {save_path}")

        # Persist the REAL chunk rows (spec §7 §19): document/page/section
        # provenance for every chunk that was actually embedded and indexed.
        for c in chunks:
            session.add(KnowledgeChunk(
                agent_id=knowledge.institute_id,
                document_id=knowledge.id,
                workspace_id=c.get("workspace_id"),
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

        # Update knowledge record
        knowledge.status = KnowledgeStatus.READY
        knowledge.ingestion_stage = "ready"
        knowledge.embedding_model = settings.EMBEDDING_MODEL
        knowledge.chunks_count = len(chunks)
        knowledge.processing_completed_at = datetime.now(timezone.utc)
        await session.commit()

        logger.info(f"=== RAG PIPELINE COMPLETE: Knowledge base ready for institute {knowledge.institute_id} ===")
        logger.info(f"Total chunks: {len(chunks)}")
        logger.info(f"Processing time: {(knowledge.processing_completed_at - knowledge.processing_started_at).total_seconds():.2f} seconds")

    except Exception as e:
        logger.error(f"RAG PIPELINE FAILED: Error processing document: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        knowledge.status = KnowledgeStatus.ERROR
        knowledge.ingestion_stage = "failed"
        knowledge.error_message = str(e)
        knowledge.ingestion_error = str(e)[:1000]
        await session.commit()
        raise



# ── Schemas for Knowledge Management ──────────────────────────────────────────
from pydantic import BaseModel


class InsertKnowledgeRequest(BaseModel):
    institute_id: Optional[int] = 1
    content: str
    title: Optional[str] = "Inserted Knowledge"


class RetrievalTestRequest(BaseModel):
    query: str
    agent_id: Optional[int] = 1
    top_k: Optional[int] = 4


@router.post("/insert")
async def insert_quick_knowledge(
    req: InsertKnowledgeRequest,
    session: AsyncSession = Depends(get_database),
):
    """
    Directly insert/append text knowledge into an agent's vector store.
    Retains the historical /insert workflow (spec §7 §14).
    """
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    inst_id = req.institute_id or 1
    agent_row = await session.get(Institute, inst_id)
    if not agent_row:
        raise HTTPException(status_code=404, detail="Institute not found")

    # Create knowledge entry
    doc_name = f"{req.title or 'Inserted Knowledge'} ({datetime.now().strftime('%Y-%m-%d %H:%M')})"
    knowledge = Knowledge(
        institute_id=inst_id,
        document_name=doc_name,
        document_type="text/plain",
        file_path="direct_insert",
        file_size=len(content.encode("utf-8")),
        status=KnowledgeStatus.PROCESSING,
        ingestion_stage="chunking",
    )
    session.add(knowledge)
    await session.commit()
    await session.refresh(knowledge)

    # Chunk text
    chunks = chunk_text(content, source_document=doc_name)
    if not chunks:
        knowledge.status = KnowledgeStatus.ERROR
        knowledge.error_message = "No chunks generated from content"
        await session.commit()
        raise HTTPException(status_code=400, detail="Could not chunk content")

    for c in chunks:
        c["agent_id"] = inst_id
        c["document_id"] = knowledge.id
        c["document_version_id"] = knowledge.id
        c["embedding_model"] = settings.EMBEDDING_MODEL

    # Embed
    knowledge.status = KnowledgeStatus.EMBEDDING
    knowledge.ingestion_stage = "embedding"
    await session.commit()
    embeddings = generate_embeddings(chunks)

    # Append to agent-scoped store
    knowledge.status = KnowledgeStatus.INDEXING
    knowledge.ingestion_stage = "indexing"
    await session.commit()
    agent_store = vector_store_manager.get_store(inst_id)
    agent_store.append_chunks(chunks, embeddings)

    # Persist vector index
    save_path = settings.BASE_DIR / "knowledge" / f"agent_{inst_id}" / "index"
    agent_store.save(str(save_path))

    # Persist chunks
    for c in chunks:
        session.add(KnowledgeChunk(
            agent_id=inst_id,
            document_id=knowledge.id,
            document_version_id=knowledge.id,
            chunk_id=c.get("chunk_id", 0),
            page_number=c.get("page_number", 1),
            section=c.get("section", req.title),
            text=c.get("text", ""),
            token_count=c.get("token_count") or max(1, len(c.get("text", "")) // 4),
            character_count=len(c.get("text", "")),
            embedding_model=settings.EMBEDDING_MODEL,
        ))
    await session.flush()

    knowledge.status = KnowledgeStatus.READY
    knowledge.ingestion_stage = "ready"
    knowledge.chunks_count = len(chunks)
    knowledge.processing_completed_at = datetime.now(timezone.utc)
    await session.commit()

    invalidate_bm25(inst_id)
    await invalidate_response_cache(inst_id)

    logger.info(f"Quick knowledge inserted for institute {inst_id} ({len(chunks)} chunks)")
    return {
        "status": "ready",
        "message": f"Successfully inserted {len(chunks)} knowledge chunks",
        "document_name": doc_name,
        "knowledge_id": knowledge.id,
        "chunks_count": len(chunks),
    }


@router.get("/documents")
async def list_documents(
    institute_id: Optional[int] = None,
    session: AsyncSession = Depends(get_database),
):
    """List all knowledge documents with status and metadata."""
    query = select(Knowledge).order_by(Knowledge.id.desc())
    if institute_id:
        query = query.where(Knowledge.institute_id == institute_id)

    res = await session.execute(query)
    docs = res.scalars().all()
    return [
        {
            "id": d.id,
            "institute_id": d.institute_id,
            "document_name": d.document_name,
            "document_type": d.document_type,
            "file_size": d.file_size,
            "chunks_count": d.chunks_count,
            "page_count": d.page_count,
            "status": d.status.value if hasattr(d.status, "value") else str(d.status),
            "ingestion_stage": d.ingestion_stage,
            "error_message": d.error_message,
            "created_at": d.uploaded_at.isoformat() if getattr(d, "uploaded_at", None) else None,
            "uploaded_at": d.uploaded_at.isoformat() if getattr(d, "uploaded_at", None) else None,
            "processing_completed_at": d.processing_completed_at.isoformat() if d.processing_completed_at else None,
        }
        for d in docs
    ]


@router.get("/documents/{document_id}")
async def get_document(
    document_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Retrieve details for a single document."""
    doc = await session.get(Knowledge, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    chunk_res = await session.execute(
        select(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
    )
    chunks = chunk_res.scalars().all()

    return {
        "id": doc.id,
        "institute_id": doc.institute_id,
        "document_name": doc.document_name,
        "document_type": doc.document_type,
        "file_size": doc.file_size,
        "chunks_count": doc.chunks_count,
        "page_count": doc.page_count,
        "status": doc.status.value if hasattr(doc.status, "value") else str(doc.status),
        "ingestion_stage": doc.ingestion_stage,
        "error_message": doc.error_message,
        "created_at": doc.uploaded_at.isoformat() if getattr(doc, "uploaded_at", None) else None,
        "uploaded_at": doc.uploaded_at.isoformat() if getattr(doc, "uploaded_at", None) else None,
        "chunks_sample": [
            {"chunk_id": c.chunk_id, "page": c.page_number, "section": c.section, "text": c.text[:200]}
            for c in chunks[:5]
        ],
    }


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Delete a document and clean up its database chunk rows and vector store."""
    doc = await session.get(Knowledge, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    inst_id = doc.institute_id

    # 1. Delete DB chunks
    await session.execute(
        sa_delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
    )

    # 2. Delete document row
    await session.delete(doc)
    await session.commit()

    # 3. Rebuild or prune the agent's FAISS vector store
    agent_store = vector_store_manager.get_store(inst_id)
    remaining_chunks = [c for c in agent_store.chunks if c.get("document_id") != document_id]

    if remaining_chunks:
        # Re-embed remaining chunks to guarantee index integrity
        embeddings = generate_embeddings(remaining_chunks)
        agent_store.build_index(remaining_chunks, embeddings)
        save_path = settings.BASE_DIR / "knowledge" / f"agent_{inst_id}" / "index"
        agent_store.save(str(save_path))
    else:
        agent_store.clear()
        save_path = settings.BASE_DIR / "knowledge" / f"agent_{inst_id}" / "index"
        for ext in (".index", ".chunks.pkl"):
            p = Path(f"{save_path}{ext}")
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass

    invalidate_bm25(inst_id)
    await invalidate_response_cache(inst_id)

    logger.info(f"Deleted document {document_id} and updated index for agent {inst_id}")
    return {
        "status": "deleted",
        "message": f"Document {document_id} successfully deleted",
        "remaining_chunks": len(remaining_chunks),
    }


@router.post("/documents/{document_id}/reindex")
async def reindex_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_database),
):
    """Trigger re-indexing of an existing document."""
    doc = await session.get(Knowledge, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(doc.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=400, detail="Original document file not found on disk to re-index")

    doc.status = KnowledgeStatus.PROCESSING
    doc.ingestion_stage = "extracting"
    await session.commit()

    background_tasks.add_task(process_document_background, document_id, file_path)
    return {
        "status": "processing",
        "message": f"Re-indexing started for document {document_id}",
    }


@router.post("/test-retrieval")
async def test_retrieval_endpoint(req: RetrievalTestRequest):
    """
    Protected retrieval test endpoint.
    Retrieves most similar chunks for a test query and returns full provenance.
    """
    from app.rag.retriever import retrieve_context
    chunks = await retrieve_context(req.query, top_k=req.top_k or 4, agent_id=req.agent_id or 1)
    return {
        "query": req.query,
        "agent_id": req.agent_id or 1,
        "chunks_found": len(chunks),
        "results": [
            {
                "chunk_id": c.get("chunk_id"),
                "document": c.get("document") or c.get("source"),
                "page": c.get("page_number"),
                "section": c.get("section"),
                "similarity_score": round(float(c.get("score", 0.0)), 4),
                "text": c.get("text"),
            }
            for c in chunks
        ],
    }


@router.get("/status")
async def get_knowledge_status_endpoint(
    institute_id: Optional[int] = 1,
    session: AsyncSession = Depends(get_database),
):
    """Check knowledge base readiness and chunk count for an institute."""
    doc_res = await session.execute(
        select(Knowledge)
        .where(Knowledge.institute_id == institute_id)
        .order_by(Knowledge.id.desc())
        .limit(1)
    )
    doc = doc_res.scalar_one_or_none()
    agent_store = vector_store_manager.get_store(institute_id)

    return {
        "institute_id": institute_id,
        "is_ready": agent_store.is_ready,
        "chunks_count": len(agent_store.chunks),
        "latest_document": doc.document_name if doc else None,
        "latest_status": (doc.status.value if hasattr(doc.status, "value") else str(doc.status)) if doc else "no_document",
        "ingestion_stage": doc.ingestion_stage if doc else "none",
    }
