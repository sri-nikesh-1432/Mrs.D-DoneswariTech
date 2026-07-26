"""
Doneswari AI Telecaller — FastAPI Backend Entry Point

Starts automatically on http://localhost:8000
Run with:
    uvicorn app:app --reload --host localhost --port 8000
"""

import os
import time
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from routes import (
    stt_router, tts_router, chat_router,
    text_chat_router, history_router, health_router,
)
from memory.session_memory import purge_expired_sessions
from services.tts_service import cleanup_old_audio_files
from utils.config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

# ── APScheduler for background jobs ──────────────────────────────────────────
_scheduler = AsyncIOScheduler()


def _ensure_directories() -> None:
    """Create all required runtime directories if they don't exist."""
    dirs = [
        settings.LOGS_DIR,
        settings.STATIC_DIR,
        settings.AUDIO_DIR,
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
        logger.debug("Directory ready: %s", d)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("🚀 Doneswari AI Telecaller starting up...")

    # Ensure all runtime directories exist
    _ensure_directories()

    # Schedule session cleanup every 10 minutes
    _scheduler.add_job(
        purge_expired_sessions,
        trigger="interval",
        minutes=10,
        id="session_cleanup",
        replace_existing=True,
    )

    # Schedule audio file cleanup based on AUDIO_CLEANUP_MINUTES
    _scheduler.add_job(
        cleanup_old_audio_files,
        trigger="interval",
        minutes=settings.AUDIO_CLEANUP_MINUTES,
        id="audio_cleanup",
        replace_existing=True,
    )

    _scheduler.start()
    logger.info("✅ Scheduler started (session + audio cleanup active)")
    logger.info("✅ Backend ready at http://%s:%d", settings.HOST, settings.PORT)
    logger.info("📖 API docs at http://%s:%d/docs", settings.HOST, settings.PORT)

    yield

    # Graceful shutdown
    _scheduler.shutdown(wait=False)
    logger.info("👋 Doneswari AI Telecaller shutting down.")


# ── FastAPI Application ───────────────────────────────────────────────────────
app = FastAPI(
    title="Doneswari AI Telecaller",
    description=(
        "Production-quality AI educational counselor with multilingual "
        "voice and text support. Powered by Groq Whisper + LLaMA + Edge-TTS."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS — allow all origins for development ──────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Transcript", "X-Answer", "X-Language", "X-Duration-Ms"],
)

# ── Static files (TTS audio output) ──────────────────────────────────────────
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

# ── API Routes ────────────────────────────────────────────────────────────────
app.include_router(health_router,     tags=["Health"])
app.include_router(stt_router,        tags=["Speech-to-Text"])
app.include_router(tts_router,        tags=["Text-to-Speech"])
app.include_router(chat_router,       tags=["Voice Chat"])
app.include_router(text_chat_router,  tags=["Text Chat"])
app.include_router(history_router,    tags=["Session & History"])


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint — confirms the server is running."""
    return {
        "agent":   "Doneswari AI Telecaller",
        "status":  "running",
        "version": "2.0.0",
        "docs":    "/docs",
        "health":  "/health",
    }
