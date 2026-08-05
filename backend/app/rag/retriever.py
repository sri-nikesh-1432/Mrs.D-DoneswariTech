"""
RAG Retriever — Given a query, retrieves the most relevant knowledge chunks.
Optimized for fast response times.
"""

from typing import List, Dict, Optional
from functools import lru_cache
import hashlib
from app.rag.embeddings import generate_embedding
from app.rag.vector_store import vector_store
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

# Simple cache for recent queries (max 128 entries)
_query_cache = {}
_cache_max_size = 128


def _get_cache_key(query: str, top_k: int, min_score: float) -> str:
    """Generate cache key for query parameters."""
    key = f"{query}:{top_k}:{min_score}"
    return hashlib.md5(key.encode()).hexdigest()


async def retrieve_context(
    query: str,
    top_k: int = None,
    min_score: float = 0.15,
) -> List[Dict]:
    """
    Retrieve the most relevant knowledge chunks for a query.
    
    Args:
        query: The question or query text
        top_k: Number of chunks to retrieve
        min_score: Minimum similarity score threshold.
            Calibrated for all-MiniLM-L6-v2 (cosine sims for relevant matches
            typically fall between 0.15 and 0.55 — a 0.3 cutoff silently drops
            relevant chunks, e.g. "What time does the hostel close?" ≈ 0.29).
        
    Returns:
        List of relevant chunks with text, source, and score
    """
    if not vector_store.is_ready:
        logger.warning("Vector store not ready")
        return []

    # Set default top_k
    if top_k is None:
        top_k = settings.TOP_K_RESULTS

    # Check cache
    cache_key = _get_cache_key(query, top_k, min_score)
    if cache_key in _query_cache:
        logger.debug(f"Cache hit for query: {query[:50]}...")
        return _query_cache[cache_key]

    try:
        # Generate query embedding
        query_embedding = generate_embedding(query)

        # Search vector store
        results = vector_store.search(query_embedding, top_k=top_k)

        # Filter by minimum score
        filtered = [r for r in results if r["score"] >= min_score]

        # Cache results
        if len(_query_cache) >= _cache_max_size:
            _query_cache.pop(next(iter(_query_cache)))
        _query_cache[cache_key] = filtered

        logger.info(f"Retrieved {len(filtered)} chunks for query (min_score={min_score})")
        
        return filtered

    except Exception as e:
        logger.error(f"Retrieval failed: {e}")
        raise


def format_context_for_prompt(retrieved_chunks: List[Dict]) -> str:
    """
    Format retrieved chunks into a context string for the LLM prompt.
    """
    if not retrieved_chunks:
        return ""

    context_parts = []
    for i, chunk in enumerate(retrieved_chunks, 1):
        source = chunk.get("source", "Unknown")
        text = chunk["text"]
        context_parts.append(f"[Source: {source}]\n{text}")

    return "\n\n---\n\n".join(context_parts)


def is_knowledge_ready() -> bool:
    """Check if the vector store is ready for queries."""
    return vector_store.is_ready
