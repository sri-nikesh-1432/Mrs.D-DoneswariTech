"""
Mrs. D — AI Voice Receptionist Platform
FastAPI Backend Entry Point

Run with:
    uvicorn app.main:app --reload --host localhost --port 8000
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config.settings import settings
from app.logs.logger import get_logger
from app.database.connection import init_database

logger = get_logger(__name__)

_scheduler = AsyncIOScheduler()


async def _restore_vector_store() -> None:
    """
    Reload the most recent READY knowledge base vector store from disk.
    Without this, the FAISS index is empty after a restart even though the
    database says the knowledge is ready, and all retrievals return nothing.
    """
    try:
        from sqlalchemy import select
        from pathlib import Path
        from app.database.connection import AsyncSessionLocal
        from app.database.models import Knowledge, KnowledgeStatus
        from app.rag.vector_store import vector_store

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Knowledge)
                .where(Knowledge.status == KnowledgeStatus.READY)
                .order_by(Knowledge.id.desc())
                .limit(1)
            )
            knowledge = result.scalar_one_or_none()

            if not knowledge:
                logger.info("No ready knowledge base found at startup")
                return

            vec_path = Path(knowledge.file_path).parent / f"knowledge_{knowledge.institute_id}"
            if vector_store.load(str(vec_path)):
                logger.info(
                    "Vector store restored at startup: %s (%d chunks)",
                    knowledge.document_name, len(vector_store.chunks),
                )
            else:
                logger.warning(
                    "Knowledge %s is marked READY but no vector store file found at %s — re-upload to rebuild",
                    knowledge.document_name, vec_path,
                )
    except Exception as e:
        logger.error("Failed to restore vector store at startup: %s", e)


def _ensure_directories() -> None:
    """Create all required runtime directories."""
    dirs = [
        settings.LOGS_DIR,
        settings.STATIC_DIR,
        settings.AUDIO_DIR,
        settings.UPLOADS_DIR,
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
        logger.debug("Directory ready: %s", d)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("Mrs. D - AI Voice Receptionist Platform starting up...")
    _ensure_directories()
    await init_database()
    await _restore_vector_store()

    _scheduler.start()
    logger.info("Scheduler started")
    logger.info("Backend ready at http://%s:%d", settings.HOST, settings.PORT)
    logger.info("API docs at http://%s:%d/docs", settings.HOST, settings.PORT)

    yield

    _scheduler.shutdown(wait=False)
    # Close the persistent Edge TTS websocket so the app exits cleanly and
    # never leaks the connection across restarts.
    try:
        from app.tts.raw_ssml import close_raw_synth
        await close_raw_synth()
    except Exception as e:
        logger.warning("Error closing Edge TTS connection: %s", e)
    logger.info("Mrs. D shutting down.")


app = FastAPI(
    title="Mrs. D — AI Voice Receptionist Platform",
    description="AI-powered voice receptionist for incoming calls.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static Files ──────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

# ── Import and include routers ────────────────────────────────────────────────
from app.api import knowledge_router
from app.api.receptionist_routes import router as receptionist_router
from app.api.conversation_routes import router as conversation_router
from app.api.single_call_routes import router as single_call_router
from app.voice.voice_ws import router as voice_ws_router

app.include_router(knowledge_router)
app.include_router(receptionist_router)
app.include_router(conversation_router)
app.include_router(single_call_router)
app.include_router(voice_ws_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "agent": "Mrs. D",
        "platform": "AI Voice Receptionist Platform",
        "status": "running",
        "version": "2.0.0",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    from datetime import datetime, timezone
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "groq_configured": settings.is_groq_configured,
        "models": {
            "llm": settings.GROQ_MODEL,
            "stt": settings.GROQ_STT_MODEL,
            "tts": settings.TTS_VOICE,
        },
        "server": {
            "host": settings.HOST,
            "port": settings.PORT,
            "version": "2.0.0",
        },
        "agent": "Mrs. D",
    }
