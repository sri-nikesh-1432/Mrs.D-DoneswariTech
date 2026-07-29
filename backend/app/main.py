"""
Mrs. D — AI Admission Campaign Platform
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
        settings.REPORTS_DIR,
    ]
    for d in dirs:
        os.makedirs(d, exist_ok=True)
        logger.debug("Directory ready: %s", d)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("🚀 Mrs. D — AI Admission Campaign Platform starting up...")
    _ensure_directories()
    await init_database()

    _scheduler.start()
    logger.info("✅ Scheduler started")
    logger.info("✅ Backend ready at http://%s:%d", settings.HOST, settings.PORT)
    logger.info("📖 API docs at http://%s:%d/docs", settings.HOST, settings.PORT)

    yield

    _scheduler.shutdown(wait=False)
    logger.info("👋 Mrs. D shutting down.")


app = FastAPI(
    title="Mrs. D — AI Admission Campaign Platform",
    description="Automate admissions with an intelligent AI counselor.",
    version="1.0.0",
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
from app.api import (
    knowledge_router,
    student_router,
    campaign_router,
    websocket_router,
    analytics_router
)

app.include_router(knowledge_router)
app.include_router(student_router)
app.include_router(campaign_router)
app.include_router(websocket_router)
app.include_router(analytics_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "agent": "Mrs. D",
        "platform": "AI Admission Campaign Platform",
        "status": "running",
        "version": "1.0.0",
        "docs": "/docs",
    }
