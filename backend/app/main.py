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
    Reload every agent's READY knowledge base from the standard
    knowledge/agent_{id}/index path. vector_store_manager.get_store()
    auto-loads an agent's own isolated index from disk, so this simply
    pre-warms the in-memory stores for all agents that have a READY
    knowledge record.

    Each agent gets ONLY its own index — an onboarding/upload for agent N
    can never leak into another agent's store after a restart (spec §2 §9).
    """
    try:
        from sqlalchemy import select
        from app.database.connection import AsyncSessionLocal
        from app.database.models import Knowledge, KnowledgeStatus
        from app.rag.vector_store import vector_store_manager

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Knowledge.institute_id)
                .where(Knowledge.status == KnowledgeStatus.READY)
                .distinct()
            )
            agent_ids = [row[0] for row in result.all()]

            if not agent_ids:
                logger.info("No ready knowledge base found at startup")
                return

            restored = 0
            for agent_id in agent_ids:
                store = vector_store_manager.get_store(agent_id)
                if store.is_ready:
                    restored += 1
                    logger.info(
                        "Vector store restored for agent %d (%d chunks)",
                        agent_id, len(store.chunks),
                    )
                else:
                    logger.warning(
                        "Agent %d is marked READY but no vector store found at "
                        "knowledge/agent_%d/index — re-upload to rebuild",
                        agent_id, agent_id,
                    )
            logger.info("Vector store restore complete: %d/%d agents ready", restored, len(agent_ids))
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

    from app.database.models import Institute

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(Knowledge)
                .where(Knowledge.status == KnowledgeStatus.READY)
                .order_by(Knowledge.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        # The preloaded answers must speak as THIS agent (name/company), never
        # as a generic default persona.
        agent_row = await session.get(Institute, row.institute_id) if row else None
    if not row:
        logger.info("Common-question preload skipped: no READY knowledge base")
        return

    agent_id = row.institute_id
    agent_name = (agent_row.agent_name if agent_row else None) or "the counsellor"
    company_name = (agent_row.name if agent_row else None) or "the organization"
    instructions = agent_row.instructions if agent_row else None
    tts = get_tts_service()
    preloaded = 0
    for q in COMMON_QUESTIONS:
        try:
            chunks = await retrieve_context(q, top_k=4, agent_id=agent_id)
            context = format_context_for_prompt(chunks)
            parts: list[str] = []
            async for delta in stream_chat_fast(
                q,
                context=context,
                agent_name=agent_name,
                company_name=company_name,
                instructions=instructions,
            ):
                parts.append(delta)
            answer = " ".join("".join(parts).split())
            if not answer:
                continue
            # Strip any passive "anything else?" ask before it is cached —
            # repeat questions must still get a real counselling question.
            from app.conversation.counsellor import strip_passive_phrases
            answer = strip_passive_phrases(answer) or answer
            await cache_response(q, agent_id, answer, "English")
            # Cache the first-sentence audio for instant playback
            first_sentence = answer.split(". ")[0]
            if not first_sentence.endswith("."):
                first_sentence += "."
            audio = await tts.synthesize(first_sentence, language="English")
            if audio:
                import base64 as _b64
                _audio_cache_put(_audio_key(q, agent_id, "English"), _b64.b64encode(audio).decode("utf-8"))
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
        # Warm the embedding model (FastEmbed/ONNX) OFF the event loop.
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
        # NOTE (spec §1 §3 §14): no prewritten "thinking filler" audio is
        # warmed — the agent never plays canned responses. Latency comes from
        # the streaming pipeline (parallel RAG + streaming LLM/TTS).
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

# ── Security headers (spec §63) ──────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "microphone=(self)"
    return response

# ── CORS — restricted to configured origins (spec §63) ───────────────────────
# ALLOWED_ORIGINS defaults to ["*"] for local dev (credentials off per the CORS
# spec); production operators set explicit origins in .env.
_allowed = settings.ALLOWED_ORIGINS or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_credentials="*" not in _allowed,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Simple in-memory rate limiter (spec §63) ─────────────────────────────────
# Fixed-window per client IP for sensitive endpoints (auth + call initiation).
# Swap the dict for Redis when scaling beyond a single worker.
import time as _time
import collections as _collections

_RATE_BUCKETS: dict = {}
_RATE_RULES = {
    "/api/auth/login": (10, 60),      # 10/min per IP
    "/api/auth/signup": (6, 60),      # 6/min per IP
    "/api/agents/": (60, 60),         # 60/min for agent action routes
}

@app.middleware("http")
async def rate_limit(request, call_next):
    path = request.url.path
    rule = None
    for prefix, r in _RATE_RULES.items():
        if path.startswith(prefix):
            rule = r
            break
    if rule and request.method in ("POST", "PUT", "DELETE"):
        limit, window = rule
        ip = request.client.host if request.client else "unknown"
        key = f"{ip}:{path.rsplit('/', 1)[0] or path}"
        now = _time.time()
        dq = _RATE_BUCKETS.setdefault(key, _collections.deque())
        while dq and dq[0] < now - window:
            dq.popleft()
        if len(dq) >= limit:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=429, content={"detail": "Too many requests — slow down."})
        dq.append(now)
    return await call_next(request)

# ── Static Files ──────────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

# ── Import and include routers ────────────────────────────────────────────────
from app.api.auth_routes import router as auth_router
from app.api import knowledge_router
from app.api.receptionist_routes import router as receptionist_router
from app.api.conversation_routes import router as conversation_router
from app.api.analytics_routes import router as analytics_router
from app.api.telephony_routes import router as telephony_router
from app.api.telephony_routes import agent_telephony_router
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
app.include_router(agent_telephony_router)
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
    """
    Health check with per-component statuses (spec §67):
    backend, database, vector DB, LLM, embedding, telephony config, realtime.
    Returns REAL statuses — never fabricated.
    """
    from datetime import datetime, timezone
    from sqlalchemy import text as _sql_text
    from app.database.connection import engine
    from app.rag.vector_store import vector_store_manager
    from app.tts.edge_tts_service import get_tts_service
    from app.telephony.twilio_service import twilio_service

    components: dict = {}

    # 1. Backend process — implicit; we are serving this request.
    components["backend"] = "healthy"

    # 2. Database — real connectivity probe.
    try:
        async with engine.connect() as conn:
            await conn.execute(_sql_text("SELECT 1"))
        components["database"] = "healthy"
    except Exception as e:
        components["database"] = f"unhealthy: {str(e)[:120]}"

    # 3. Vector DB — any agent store ready on disk/memory.
    try:
        any_ready = any(
            s.is_ready for s in vector_store_manager._stores.values()
        )
        if not any_ready:
            # Check the default agent_1 path on disk.
            from pathlib import Path
            any_ready = (settings.BASE_DIR / "knowledge" / "agent_1" / "index.index").exists()
        components["vector_db"] = "ready" if any_ready else "no_index_built"
    except Exception as e:
        components["vector_db"] = f"unhealthy: {str(e)[:120]}"

    # 4. LLM — configuration presence (a real call probe would burn quota).
    components["llm"] = "configured" if settings.is_groq_configured else "not_configured"

    # 5. Embedding service — model loadable flag (loaded lazily).
    try:
        from app.rag.embeddings import _model as _emb_model
        components["embedding"] = "model_loaded" if _emb_model is not None else "lazy_load_on_first_use"
    except Exception:
        components["embedding"] = "lazy_load_on_first_use"

    # 6. Voice/TTS.
    try:
        tts = get_tts_service()
        components["voice"] = "ready" if tts is not None else "not_ready"
    except Exception as e:
        components["voice"] = f"unhealthy: {str(e)[:120]}"

    # 7. Telephony — real credential presence (spec §32 §54).
    components["telephony"] = (
        "configured" if twilio_service.is_configured()
        else "not_configured (real calls disabled — set TWILIO_* env vars)"
    )

    # 8. Realtime voice WS — endpoint mounted means available.
    components["realtime"] = "ready"

    unhealthy = [k for k, v in components.items() if str(v).startswith("unhealthy")]
    return {
        "status": "unhealthy" if unhealthy else "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "components": components,
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
        "platform": "AI Telecaller SaaS",
    }
