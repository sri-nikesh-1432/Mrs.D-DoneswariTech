"""
Mrs. D — AI Voice Receptionist Platform
FastAPI Backend Entry Point

Run with:
    uvicorn app.main:app --reload --host localhost --port 8000
"""

import asyncio
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



async def _warmup_tts() -> None:
    """Pre-warm the Edge-TTS persistent WebSocket per active voice for low-latency first response."""
    try:
        from app.tts.edge_tts_service import get_tts_service
        tts = get_tts_service()
        await tts.initialize()

        # Warm ONLY the primary voices actually used in production. All 12
        # voices (incl. every "-Alt") took ~70s of continuous edge-tts traffic
        # and starved real calls of the service (greeting TTS hung mid-stream).
        warm_phrases: dict[str, str] = {
            "en-IN-NeerjaNeural": "Hello!",
        }
        warmed = 0
        for voice, phrase in warm_phrases.items():
            try:
                audio = await tts.synthesize(phrase, voice=voice)
                if audio:
                    warmed += 1
            except Exception as e:
                logger.debug("TTS warmup skipped for voice %s: %s", voice, e)

        if warmed:
            logger.info("TTS WebSocket warmed up for %d voices", warmed)
        else:
            logger.warning("TTS warmup produced no audio on any voice")
    except Exception as e:
        logger.warning("TTS warmup failed (non-fatal): %s", e)

COMMON_QUESTIONS = [
    "What is the fee?",
    "Do you provide hostel facility?",
    "What courses do you offer?",
    "What is the admission process?",
]


async def _preload_common_questions() -> None:
    """Answer the common questions once against the READY knowledge base and
    cache both the text and the first-sentence audio. Repeat callers get
    near-zero-latency replies for exactly the questions they ask most."""
    from sqlalchemy import select
    from app.database.connection import AsyncSessionLocal
    from app.database.models import Knowledge, KnowledgeStatus
    from app.rag.retriever import retrieve_context, format_context_for_prompt
    from app.rag.groq_service import stream_chat_fast
    from app.rag.response_cache import cache_response
    from app.tts.edge_tts_service import get_tts_service
    from app.voice.voice_ws import _audio_key, _audio_cache_put

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(Knowledge)
                .where(Knowledge.status == KnowledgeStatus.READY)
                .order_by(Knowledge.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if not row:
        logger.info("Common-question preload skipped: no READY knowledge base")
        return

    agent_id = row.institute_id
    tts = get_tts_service()
    preloaded = 0
    for q in COMMON_QUESTIONS:
        try:
            chunks = await retrieve_context(q, top_k=4, agent_id=agent_id)
            context = format_context_for_prompt(chunks)
            parts: list[str] = []
            async for delta in stream_chat_fast(q, context=context):
                parts.append(delta)
            answer = " ".join("".join(parts).split())
            if not answer:
                continue
            await cache_response(q, agent_id, answer)
            # Cache the first-sentence audio for instant playback
            first_sentence = answer.split(". ")[0]
            if not first_sentence.endswith("."):
                first_sentence += "."
            audio = await tts.synthesize(first_sentence, language="English")
            if audio:
                import base64 as _b64
                _audio_cache_put(_audio_key(q, agent_id), _b64.b64encode(audio).decode("utf-8"))
            preloaded += 1
        except Exception as e:
            logger.debug("Preload failed for %r: %s", q, e)
    logger.info("Common questions preloaded for agent %d: %d/%d", agent_id, preloaded, len(COMMON_QUESTIONS))


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

    # TTS warmup used to BLOCK startup: ~12 voice pings + up to 18 cache
    # phrases sequentially = 2-3 minutes before the port even bound. Run it
    # as a background task with a hard timeout so the server serves
    # immediately and the caches fill in behind it.
    async def _warmup_background():
        # edge-tts throttles under concurrent load ("No audio was received" +
        # multi-second stalls). Warmups once starved REAL calls of the voice
        # service, so pre-synthesis stays minimal here — but the persistent
        # raw-SSML socket MUST connect at startup, otherwise the first live
        # turn pays the full TLS+WS handshake (~1.5s) and blows the <700ms
        # TTFA budget. Warm the primary English voice immediately.
        try:
            await asyncio.wait_for(_warmup_tts(), timeout=45)
        except Exception as e:
            logger.warning("TTS warmup stopped (non-fatal): %s", e)
        # Warm the SentenceTransformer embedding model OFF the event loop.
        # Loading it lazily on the first voice turn blocks the whole loop for
        # ~10s (websocket pings time out and clients disconnect).
        try:
            await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None, lambda: __import__("app.rag.embeddings", fromlist=["_get_model"])._get_model()
                ),
                timeout=120,
            )
            logger.info("Embedding model warmed up")
        except Exception as e:
            logger.warning("Embedding warmup stopped (non-fatal): %s", e)
        try:
            from app.rag.response_cache import warm_tts_cache
            from app.tts.edge_tts_service import get_tts_service
            await asyncio.wait_for(warm_tts_cache(get_tts_service(), max_entries=2), timeout=60)
        except Exception as e:
            logger.warning("TTS cache warmup stopped (non-fatal): %s", e)
        # Preload the most common admissions questions (text + first-sentence
        # audio) so the highest-traffic questions answer in <100ms TTFA.
        try:
            await asyncio.wait_for(_preload_common_questions(), timeout=240)
        except Exception as e:
            logger.warning("Common-question preload stopped (non-fatal): %s", e)

    asyncio.create_task(_warmup_background())
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
    title="Doneswari AI Telecaller Platform",
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
from app.api.auth_routes import router as auth_router
from app.api import knowledge_router
from app.api.receptionist_routes import router as receptionist_router
from app.api.conversation_routes import router as conversation_router
from app.api.analytics_routes import router as analytics_router
from app.api.telephony_routes import router as telephony_router
from app.voice.voice_ws import router as voice_ws_router
from app.api.onboard_routes import router as onboard_router
from app.api.agent_routes import router as agent_router
from app.api.student_routes import router as student_router
from app.api.campaign_routes import router as campaign_router
from app.api.calls_routes import router as calls_router

app.include_router(auth_router)
app.include_router(knowledge_router)
app.include_router(receptionist_router)
app.include_router(conversation_router)
app.include_router(analytics_router)
app.include_router(telephony_router)
app.include_router(voice_ws_router)
app.include_router(onboard_router)
app.include_router(agent_router)
app.include_router(student_router)
app.include_router(campaign_router)
app.include_router(calls_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "agent": "Mrs. D",
        "platform": "Doneswari AI Telecaller SaaS Platform",
        "status": "running",
        "version": "2.0.0",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint returning actual status (spec §50)."""
    from datetime import datetime, timezone
    from app.rag.vector_store import vector_store
    from app.tts.edge_tts_service import get_tts_service
    
    # Check RAG status
    rag_ready = vector_store.is_ready
    
    # Check voice/TTS status
    try:
        tts = get_tts_service()
        voice_ready = tts is not None
    except Exception:
        voice_ready = False
    
    # Check realtime WebSocket (basic check - actual connection tested on connect)
    realtime_ready = True  # WebSocket endpoint is always available
    
    return {
        "status": "healthy" if (rag_ready and voice_ready and realtime_ready) else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "rag": "ready" if rag_ready else "not_ready",
        "voice": "ready" if voice_ready else "not_ready",
        "realtime": "ready" if realtime_ready else "not_ready",
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
