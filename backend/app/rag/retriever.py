"""
RAG Retriever — Given a query, retrieves the most relevant knowledge chunks.
Enforces strict multi-tenant agent isolation so Agent A never accesses Agent B data.
"""

from typing import List, Dict, Optional
import hashlib
from app.rag.embeddings import generate_embedding
from app.rag.vector_store import vector_store_manager, vector_store
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

# Cache for recent queries per agent
_query_cache = {}
_cache_max_size = 256


def _get_cache_key(query: str, top_k: int, min_score: float, agent_id: int) -> str:
    key = f"{query.strip().lower()}:{top_k}:{min_score}:{agent_id}"
    return hashlib.md5(key.encode()).hexdigest()


def is_knowledge_ready(agent_id: int = 1) -> bool:
    """Check if the specific agent's knowledge base is ready."""
    store = vector_store_manager.get_store(agent_id)
    return store.is_ready


async def retrieve_context(
    query: str,
    top_k: int = None,
    min_score: float = 0.15,
    institute_id: Optional[int] = None,
    agent_id: Optional[int] = None,
) -> List[Dict]:
    """
    Retrieve the most relevant knowledge chunks strictly isolated to this agent.
    """
    target_agent_id = agent_id or institute_id or 1
    store = vector_store_manager.get_store(target_agent_id)

    if not store.is_ready:
        logger.warning("Vector store not ready for agent %d", target_agent_id)
        return []

    if top_k is None:
        top_k = settings.TOP_K_RESULTS

    cache_key = _get_cache_key(query, top_k, min_score, target_agent_id)
    if cache_key in _query_cache:
        return _query_cache[cache_key]

    try:
        query_embedding = generate_embedding(query)
        results = store.search(query_embedding, top_k=top_k)

        # Filter by minimum score
        filtered = [r for r in results if r["score"] >= min_score]

        if len(_query_cache) >= _cache_max_size:
            _query_cache.pop(next(iter(_query_cache)))
        _query_cache[cache_key] = filtered

        logger.info("Agent %d retrieved %d chunks for query: %s", target_agent_id, len(filtered), query[:40])
        return filtered

    except Exception as e:
        logger.error("Agent %d retrieval failed: %s", target_agent_id, e)
        return []


def format_context_for_prompt(chunks: List[Dict]) -> str:
    """Format retrieved chunks into clean text for system context injection."""
    if not chunks:
        return ""
    parts = []
    for i, c in enumerate(chunks):
        text = c.get("text", "").strip()
        if text:
            parts.append(f"[Fact {i+1}]: {text}")
    return "\n\n".join(parts)
