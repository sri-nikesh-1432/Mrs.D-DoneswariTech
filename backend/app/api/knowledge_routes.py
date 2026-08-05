"""
Knowledge API Routes - Handle document upload and knowledge base operations.
RAG is a hidden internal engine — the user only sees "Knowledge Ready".
"""

import uuid
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone
import asyncio

from app.database.connection import get_database
from app.database.models import Institute, Knowledge, KnowledgeStatus
from app.uploads.document_service import DocumentService
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
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
        
        # IMPORTANT: Delete old vectors for this institute before creating new ones
        # This ensures only ONE active knowledge base per institute
        logger.info(f"Clearing old vectors for institute {knowledge.institute_id}...")
        vector_store.clear()
        logger.info("Old vectors cleared")
        
        # Update status to processing
        knowledge.status = KnowledgeStatus.PROCESSING
        knowledge.processing_started_at = datetime.now(timezone.utc)
        await session.commit()
        
        # Extract text (simplified - no quality gate for speed)
        logger.info("Extracting text...")
        document_service = DocumentService()
        text = await document_service.extract_text(file_path)
        
        if not text or not text.strip():
            logger.error("Extracted text is empty")
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = "Extracted text is empty"
            await session.commit()
            return
        
        logger.info(f"Extracted {len(text)} characters")
        
        # Chunk text (simplified - no quality gate for speed)
        logger.info("Chunking text...")
        chunks = chunk_text(text, source_document=knowledge.document_name)
        
        if not chunks or len(chunks) == 0:
            logger.error("No chunks generated")
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = "No chunks generated from text"
            await session.commit()
            return
        
        logger.info(f"Generated {len(chunks)} chunks")
        
        # Update status to embedding
        knowledge.status = KnowledgeStatus.EMBEDDING
        await session.commit()
        
        # Generate embeddings (simplified - no quality gate for speed)
        logger.info("Generating embeddings...")
        embeddings = generate_embeddings(chunks)
        
        logger.info(f"Generated {embeddings.shape[0]} embeddings")
        
        # Build vector store (simplified - no quality gate for speed)
        logger.info("Building vector store...")
        vector_store.build_index(chunks, embeddings)
        
        logger.info(f"Vector store ready with {len(vector_store.chunks)} chunks")
        
        # Save vector store
        vector_store_path = f"knowledge_{knowledge.institute_id}"
        vector_store.save(str(file_path.parent / vector_store_path))
        logger.info(f"Vector store saved to {vector_store_path}")
        
        # Update knowledge record
        knowledge.status = KnowledgeStatus.READY
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
        knowledge.error_message = str(e)
        await session.commit()


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
        
        # Clear vector store
        vector_store.clear()
        
        # Delete database record
        await session.delete(knowledge)
        await session.commit()
        
        return {"message": "Knowledge deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting knowledge: {e}")
        raise HTTPException(status_code=500, detail=str(e))
