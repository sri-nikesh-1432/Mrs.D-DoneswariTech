"""
Knowledge API Routes - Handle document upload and knowledge base operations.
"""

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import pandas as pd

from app.database.connection import get_database
from app.database.models import Campaign, Knowledge, KnowledgeStatus
from app.uploads.document_service import DocumentService
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.campaign.campaign_service import CampaignService
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


@router.post("/upload")
async def upload_knowledge(
    campaign_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_database)
):
    """
    Upload institute knowledge document.
    
    Supports: PDF, DOCX, TXT, CSV
    """
    try:
        # If no campaign_id provided, create a default campaign
        if not campaign_id:
            # Create a default campaign for single student calls
            campaign = Campaign(
                campaign_id="default_single_call",
                campaign_name="Single Student Call Campaign",
                institute_name="Default Institute",
                status="pending",
                language="en",
                voice="en-US-AriaNeural",
                total_students=0,
                calls_completed=0,
                calls_failed=0,
                calls_in_progress=0,
                interested=0,
                follow_up_required=0,
                average_duration=0,
                knowledge_ready=False,
                progress=0
            )
            session.add(campaign)
            await session.commit()
            await session.refresh(campaign)
            campaign_id = campaign.id
            logger.info(f"Created default campaign {campaign_id} for knowledge upload")
        
        # Get campaign
        campaign_service = CampaignService()
        campaign = await campaign_service.get_campaign(session, campaign_id)
        
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
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
            campaign_id=campaign_id,
            document_name=file.filename,
            document_type=file.content_type,
            file_path=str(file_path),
            file_size=len(file_content),
            status=KnowledgeStatus.PROCESSING
        )
        session.add(knowledge)
        await session.commit()
        await session.refresh(knowledge)
        
        # Process document asynchronously
        await process_document(session, knowledge, file_path)
        
        return {
            "message": "Document uploaded successfully",
            "knowledge_id": knowledge.id,
            "campaign_id": campaign_id,
            "status": knowledge.status.value
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading knowledge: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def process_document(session: AsyncSession, knowledge: Knowledge, file_path):
    """Process document: extract text, chunk, embed, and build vector store."""
    try:
        # Update status to processing
        knowledge.status = KnowledgeStatus.PROCESSING
        knowledge.processing_started_at = pd.Timestamp.utcnow()
        await session.commit()
        
        # Extract text
        document_service = DocumentService()
        text = await document_service.extract_text(file_path)
        
        # Update status to chunking
        knowledge.status = KnowledgeStatus.CHUNKING
        await session.commit()
        
        # Chunk text
        chunks = chunk_text(text, source_document=knowledge.document_name)
        
        # Update status to embedding
        knowledge.status = KnowledgeStatus.EMBEDDING
        await session.commit()
        
        # Generate embeddings
        embeddings = generate_embeddings(chunks)
        
        # Build vector store
        vector_store.build_index(chunks, embeddings)
        
        # Save vector store
        vector_store_path = f"knowledge_{knowledge.campaign_id}"
        vector_store.save(str(file_path.parent / vector_store_path))
        
        # Update knowledge record
        knowledge.status = KnowledgeStatus.READY
        knowledge.chunks_count = len(chunks)
        knowledge.processing_completed_at = pd.Timestamp.utcnow()
        await session.commit()
        
        logger.info(f"Knowledge base ready for campaign {knowledge.campaign_id}")
    
    except Exception as e:
        logger.error(f"Error processing document: {e}")
        knowledge.status = KnowledgeStatus.ERROR
        knowledge.error_message = str(e)
        await session.commit()


@router.get("/status/{campaign_id}")
async def get_knowledge_status(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get knowledge base status for a campaign."""
    try:
        result = await session.execute(
            select(Knowledge).where(Knowledge.campaign_id == campaign_id)
        )
        knowledge = result.scalar_one_or_none()
        
        if not knowledge:
            return {
                "campaign_id": campaign_id,
                "status": "not_uploaded"
            }
        
        return {
            "knowledge_id": knowledge.id,
            "campaign_id": campaign_id,
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
