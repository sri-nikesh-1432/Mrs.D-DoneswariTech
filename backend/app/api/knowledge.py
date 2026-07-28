"""
Knowledge upload and processing API endpoints.
"""

import os
import uuid
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.config import settings
from app.campaign.manager import campaign_manager
from app.rag.document_processor import validate_file
from app.rag.retriever import is_knowledge_ready
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv"}


@router.post("/upload-knowledge")
async def upload_knowledge(
    file: UploadFile = File(...),
    campaign_id: int = Form(...),
):
    """
    Upload a knowledge document for a campaign.
    Supports PDF, DOCX, TXT, CSV formats.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file
    contents = await file.read()
    file_size = len(contents)

    # Validate
    is_valid, error_msg = validate_file(file.filename, file_size)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # Save file
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(settings.UPLOADS_DIR, unique_name)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(contents)

    logger.info("Knowledge file saved: %s (%d bytes)", file_path, file_size)

    # Process in background
    result = await campaign_manager.process_knowledge_document(
        campaign_id=campaign_id,
        filename=file.filename,
        file_path=file_path,
        file_type=ext.lstrip("."),
        file_size=file_size,
    )

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Processing failed"))

    return {
        "success": True,
        "message": "Knowledge document processed successfully",
        "doc_id": result.get("doc_id"),
        "chunk_count": result.get("chunk_count"),
        "status": "ready",
        "knowledge_ready": is_knowledge_ready(),
    }


@router.get("/knowledge-status")
async def knowledge_status():
    """Check if knowledge base is ready."""
    return {
        "ready": is_knowledge_ready(),
    }
