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
    session: AsyncSession = Depends(get_database)
):
    """
    Upload institute knowledge document.
    Supports: PDF, DOCX, TXT, CSV
    Processing happens synchronously to ensure completion.
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
        
        logger.info(f"Document upload initiated for {file.filename}, processing synchronously")
        
        # Process document synchronously - wait for completion
        await process_document(session, knowledge, file_path)
        
        logger.info(f"Document processing complete for {file.filename}")
        
        return {
            "message": "Document uploaded and processed successfully",
            "knowledge_id": knowledge.id,
            "institute_id": institute_id,
            "institute_name": institute.name,
            "status": knowledge.status.value
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


@router.get("/status/{institute_id}")
async def get_knowledge_status(
    institute_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get knowledge base status for an institute."""
    try:
        # Only ONE active knowledge base per institute — pick the latest upload.
        # Old rows stay in the DB for history, but the current active one is always the newest.
        result = await session.execute(
            select(Knowledge)
            .where(Knowledge.institute_id == institute_id)
            .order_by(Knowledge.id.desc())
            .limit(1)
        )
        knowledge = result.scalar_one_or_none()
        
        if not knowledge:
            return {
                "institute_id": institute_id,
                "status": "not_uploaded"
            }
        
        return {
            "knowledge_id": knowledge.id,
            "institute_id": institute_id,
            "document_name": knowledge.document_name,
            "status": knowledge.status.value,
            "chunks_count": knowledge.chunks_count,
            "uploaded_at": knowledge.uploaded_at.isoformat() if knowledge.uploaded_at else None,
            "error_message": knowledge.error_message
        }
    
    except Exception as e:
        logger.error(f"Error getting knowledge status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{knowledge_id}")
async def delete_knowledge(
    knowledge_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Delete knowledge base."""
    try:
        result = await session.execute(
            select(Knowledge).where(Knowledge.id == knowledge_id)
        )
        knowledge = result.scalar_one_or_none()
        
        if not knowledge:
            raise HTTPException(status_code=404, detail="Knowledge not found")
        
        # Delete file
        document_service = DocumentService()
        await document_service.delete_file(knowledge.file_path)
        
        # Clear THIS agent's isolated store only (spec §2 §9)
        vector_store_manager.get_store(knowledge.institute_id).clear()
        
        # Delete database record
        await session.delete(knowledge)
        await session.commit()
        
        return {"message": "Knowledge deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting knowledge: {e}")
        raise HTTPException(status_code=500, detail=str(e))
