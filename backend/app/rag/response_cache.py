"""
Response cache for Mrs.D voice agent.

Two-tier cache:
  1. Per-institute LRU cache keyed by (normalized_query, institute_id)
  2. Common-query preload for phrases like "what courses" / "fee" / "hostel"

Cache hit → skip LLM entirely → ~0ms latency for repeated questions.
Cache miss → full RAG+LLM pipeline → store result for next time.
"""

import asyncio
import hashlib
import time
from typing import Optional

from app.logs.logger import get_logger

logger = get_logger(__name__)

# ─── LRU entry ───────────────────────────────────────────────────────────────

class _CacheEntry:
    __slots__ = ("text", "ts", "hits")

    def __init__(self, text: str):
        self.text = text
        self.ts = time.monotonic()
        self.hits = 0


# ─── Cache store ─────────────────────────────────────────────────────────────

_CACHE: dict[str, _CacheEntry] = {}  # key -> entry
_MAX_ENTRIES = 500
_TTL_SECONDS = 3600  # 1 hour

_lock = asyncio.Lock()


def _make_key(query: str, institute_id: int) -> str:
    normalized = " ".join(query.lower().split())[:120]
    return hashlib.md5(f"{institute_id}:{normalized}".encode()).hexdigest()


def _evict_if_needed():
    """Remove expired entries; evict LRU if still over limit."""
    now = time.monotonic()
    expired = [k for k, v in _CACHE.items() if now - v.ts > _TTL_SECONDS]
    for k in expired:
        del _CACHE[k]
    while len(_CACHE) >= _MAX_ENTRIES:
        # Evict least-recently-used (lowest ts)
        lru = min(_CACHE, key=lambda k: _CACHE[k].ts)
        del _CACHE[lru]


async def get_cached_response(query: str, institute_id: int) -> Optional[str]:
    """Return cached response text or None."""
    if not query or not query.strip():
        return None
    key = _make_key(query, institute_id)
    async with _lock:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        now = time.monotonic()
        if now - entry.ts > _TTL_SECONDS:
            del _CACHE[key]
            return None
        entry.hits += 1
        entry.ts = now  # bump for LRU
        logger.debug("Cache HIT (hits=%d): %.40s", entry.hits, query)
        return entry.text


async def cache_response(query: str, institute_id: int, text: str) -> None:
    """Store a response in the cache."""
    if not query or not text:
        return
    key = _make_key(query, institute_id)
    async with _lock:
        _evict_if_needed()
        _CACHE[key] = _CacheEntry(text)
        logger.debug("Cache SET: %.40s", query)


async def invalidate_institute(institute_id: int) -> None:
    """Clear all cached responses for one institute (call after re-training)."""
    prefix_pattern = f"{institute_id}:"
    async with _lock:
        to_delete = []
        for k in _CACHE:
            # We can't reverse the MD5, but we stored institute_id in the hash
            # input. Re-hash all queries to find matches is expensive, so we
            # just clear everything — retraining is rare.
            to_delete.append(k)
        for k in to_delete:
            del _CACHE[k]
    logger.info("Cache cleared for institute %d (%d entries removed)", institute_id, len(to_delete))


async def warm_tts_cache(tts_service, max_entries: int = 2) -> None:
    """
    Pre-synthesize a handful of very common short phrases so the first real
    call gets sub-100ms TTS for those phrases.
    Kept intentionally short to avoid starving Edge-TTS on startup.
    """
    warm_phrases = [
        "Hello! How can I help you today?",
        "Sure, let me check that for you.",
    ]
    warmed = 0
    for phrase in warm_phrases[:max_entries]:
        try:
            audio = await tts_service.synthesize(phrase)
            if audio:
                warmed += 1
        except Exception as e:
            logger.debug("TTS warm-phrase failed: %s", e)
    if warmed:
        logger.info("TTS cache warmed: %d phrases", warmed)
