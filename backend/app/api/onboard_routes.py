"""
Onboarding API — POST /api/onboard
Single endpoint: accepts name + phone + agent_name + PDF file,
creates an Institute row, processes the PDF through the RAG pipeline,
and returns the agent profile with status.

This is what the frontend Onboarding page calls.
"""

import uuid
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from sqlalchemy import select

from app.database.connection import AsyncSessionLocal
from app.database.models import Institute, Knowledge, KnowledgeStatus
from app.uploads.document_service import DocumentService
from app.rag.document_processor import extract_text_detailed
from app.rag.chunker import chunk_text
from app.rag.embeddings import generate_embeddings
from app.rag.vector_store import vector_store
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["Onboarding"])


@router.post("/onboard")
async def onboard(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    phone_number: str = Form(...),
    agent_name: str = Form(default="Mrs.D"),
    language: str = Form(default="en"),
    voice: str = Form(default="en-IN-NeerjaNeural"),
    file: UploadFile = File(...),
):
    """
    Create a new account + process the uploaded PDF knowledge base.

    Flow:
      1. Validate PDF
      2. Create Institute row
      3. Save PDF to disk
      4. Create Knowledge row (status=PROCESSING)
      5. Run RAG pipeline synchronously (extract → chunk → embed → FAISS)
      6. Return agent profile

    The RAG pipeline is fast enough (~3-8s for a typical PDF) to run
    synchronously here. The frontend shows an animated training screen
    during this wait.
    """
    # ── Validate file ────────────────────────────────────────────────────
    if file.content_type not in ("application/pdf",) and not (
        file.filename or ""
    ).lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    file_content = await file.read()
    if not file_content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    max_size = 20 * 1024 * 1024  # 20 MB
    if len(file_content) > max_size:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit.")

    async with AsyncSessionLocal() as session:
        # ── Check if phone number already exists ────────────────────────
        existing = await session.execute(
            select(Institute).where(Institute.phone_number == phone_number)
        )
        institute = existing.scalar_one_or_none()

        if institute:
            # Account exists — update agent name and re-train
            institute.name = name
            if hasattr(institute, "agent_name"):
                institute.agent_name = agent_name
            institute.voice = voice
            institute.language = language
            await session.commit()
            await session.refresh(institute)
        else:
            # Create new institute
            institute = Institute(
                institute_id=f"inst_{uuid.uuid4().hex[:12]}",
                name=name,
                phone_number=phone_number,
                language=language,
                voice=voice,
            )
            # Store agent_name in greeting_message if the model has no dedicated column
            institute.greeting_message = f"__agent_name__:{agent_name}"
            session.add(institute)
            await session.commit()
            await session.refresh(institute)

        institute_id = institute.id

        # ── Save file ────────────────────────────────────────────────────
        doc_service = DocumentService()
        file_path: Path = await doc_service.save_file(file_content, file.filename or "knowledge.pdf")

        # ── Create Knowledge record ──────────────────────────────────────
        knowledge = Knowledge(
            institute_id=institute_id,
            document_name=file.filename or "knowledge.pdf",
            document_type="application/pdf",
            file_path=str(file_path),
            file_size=len(file_content),
            status=KnowledgeStatus.PROCESSING,
            processing_started_at=datetime.now(timezone.utc),
        )
        session.add(knowledge)
        await session.commit()
        await session.refresh(knowledge)

        # ── RAG pipeline (synchronous) ───────────────────────────────────
        try:
            knowledge.status = KnowledgeStatus.PROCESSING
            await session.commit()

            extraction = extract_text_detailed(str(file_path), file.filename or "knowledge.pdf")
            text = extraction.text
            if not text or not text.strip():
                raise ValueError("Could not extract text from PDF.")

            knowledge.page_count = extraction.page_count
            knowledge.extracted_character_count = extraction.extracted_character_count
            knowledge.extracted_word_count = extraction.extracted_word_count
            knowledge.extraction_method = extraction.extraction_method
            knowledge.extraction_status = extraction.extraction_status
            knowledge.extraction_previews = {"pages": extraction.page_previews[:10]}
            await session.commit()

            chunks = chunk_text(text, source_document=file.filename or "knowledge.pdf")
            if not chunks:
                raise ValueError("PDF produced no text chunks after processing.")

            knowledge.status = KnowledgeStatus.EMBEDDING
            await session.commit()

            embeddings = generate_embeddings(chunks)

            vector_store.clear()
            vector_store.build_index(chunks, embeddings)

            vec_path = file_path.parent / f"knowledge_{institute_id}"
            vector_store.save(str(vec_path))

            knowledge.status = KnowledgeStatus.READY
            knowledge.chunks_count = len(chunks)
            knowledge.processing_completed_at = datetime.now(timezone.utc)
            await session.commit()

            logger.info(
                "Onboard complete: institute=%d, chunks=%d, file=%s",
                institute_id, len(chunks), file.filename,
            )
        except Exception as e:
            logger.error("RAG pipeline failed during onboarding: %s", e)
            knowledge.status = KnowledgeStatus.ERROR
            knowledge.error_message = str(e)
            await session.commit()
            raise HTTPException(
                status_code=500,
                detail=f"Knowledge processing failed: {e}",
            )

        # ── Return agent profile ─────────────────────────────────────────
        agent_name_resolved = agent_name
        if institute.greeting_message and institute.greeting_message.startswith("__agent_name__:"):
            agent_name_resolved = institute.greeting_message.split(":", 1)[1]

        return {
            "id": institute_id,
            "institute_id": institute.institute_id,
            "name": institute.name,
            "agent_name": agent_name_resolved,
            "phone_number": institute.phone_number,
            "language": institute.language,
            "voice": institute.voice,
            "status": "ready",
            "knowledge_status": knowledge.status.value,
            "knowledge_chunks": knowledge.chunks_count,
        }
