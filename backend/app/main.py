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

    _scheduler.start()
    logger.info("Scheduler started")
    logger.info("Backend ready at http://%s:%d", settings.HOST, settings.PORT)
    logger.info("API docs at http://%s:%d/docs", settings.HOST, settings.PORT)

    yield

    _scheduler.shutdown(wait=False)
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

app.include_router(knowledge_router)
app.include_router(receptionist_router)
app.include_router(conversation_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "agent": "Mrs. D",
        "platform": "AI Voice Receptionist Platform",
        "status": "running",
        "version": "2.0.0",
        "docs": "/docs",
    }
