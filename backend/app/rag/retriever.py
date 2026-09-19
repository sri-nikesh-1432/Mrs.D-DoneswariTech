"""
RAG Retriever — Given a query, retrieves the most relevant knowledge chunks.

Hybrid retrieval (spec §10):
  1. Context-aware query rewrite (follow-ups like "what about the fee?"
     are expanded with the conversation entity — spec §11)
  2. Multi-part question splitting (spec §12)
  3. Semantic vector search (agent-isolated FAISS) — spec §9
  4. BM25 lexical search over the same agent's chunks
  5. Reciprocal-Rank-Fusion of both result lists
  6. Rerank + relevance threshold

Enforces strict multi-tenant agent isolation: a query for agent 7 can only
ever touch agent 7's vector store and BM25 index (spec §2 §9).
"""

import hashlib
import math
import re
from collections import Counter
from typing import Dict, List, Optional

from app.config.settings import settings
from app.logs.logger import get_logger
from app.rag.embeddings import generate_embedding
from app.rag.vector_store import vector_store_manager

logger = get_logger(__name__)

# Cache for recent queries per agent
_query_cache = {}
_cache_max_size = 256

# ── BM25 index (built per agent store, cached) ───────────────────────────────

_bm25_cache: Dict[int, dict] = {}  # agent_id -> {"index": BM25Okapi, "chunks": [...]}

_STOPWORDS = {
    "the", "a", "an", "is", "are", "do", "does", "did", "can", "you", "tell",
    "me", "about", "i", "want", "to", "know", "of", "for", "in", "on", "and",
    "what", "how", "much", "many", "there", "have", "has", "with", "it", "we",
}

_TOKEN_RE = re.compile(r"[a-z0-9\u0c00-\u0c7f\u0900-\u097f]+")


def _tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS]


def _get_bm25(agent_id: int):
    """Build/cached BM25 index for an agent's chunk corpus."""
    if agent_id in _bm25_cache:
        return _bm25_cache[agent_id]

    store = vector_store_manager.get_store(agent_id)
    if not store.is_ready or not store.chunks:
        return None

    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        logger.warning("rank-bm25 not installed; hybrid retrieval disabled for agent %d", agent_id)
        return None

    corpus_tokens = [_tokenize(c.get("text", "")) for c in store.chunks]
    if not any(corpus_tokens):
        return None

    try:
        index = BM25Okapi(corpus_tokens)
    except ZeroDivisionError:
        # Corpus too small / degenerate — BM25 not usable.
        return None

    entry = {"index": index, "chunks": store.chunks}
    _bm25_cache[agent_id] = entry
    return entry


def invalidate_bm25(agent_id: int) -> None:
    """Drop the cached BM25 index after a knowledge re-upload."""
    _bm25_cache.pop(agent_id, None)


# ── Query rewriting (spec §11) ───────────────────────────────────────────────

# Topic nouns worth carrying into a rewritten follow-up.
_TOPIC_HINTS = (
    "fee", "fees", "hostel", "admission", "course", "courses", "mpc", "bipc",
    "mec", "cec", "eligibility", "placement", "timing", "transport", "result",
    "faculty", "scholarship", "duration", "branch", "location", "syllabus",
)

_PRONOUNsubject = re.compile(
    r"\b(it|that|this|they|them|there|those|these)\b", re.IGNORECASE
)


def rewrite_query(query: str, conversation_history: Optional[List[Dict]] = None) -> str:
    """
    Context-aware query rewrite (spec §11): expand follow-up questions that
    refer back to the conversation ("what subjects does it have?" after MPC
    was discussed → "what subjects are included in MPC?").

    Deliberately conservative: only rewrites when the query is SHORT and
    refers via pronoun/ellipsis — normal full questions pass through
    untouched.
    """
    if not conversation_history:
        return query

    q = query.strip()
    # Only rewrite short follow-ups — full questions don't need help.
    if len(q.split()) > 8:
        return query

    # Find the most recent user entity/topic in history.
    last_user = next(
        (m.get("content", "") for m in reversed(conversation_history) if m.get("role") == "user"),
        "",
    )
    if not last_user:
        return query

    last_user_terms = [
        t for t in _tokenize(last_user)
        if any(h in t for h in _TOPIC_HINTS) or len(t) >= 4
    ]
    # Prefer capitalized/course-like tokens from the last user turn.
    entity = None
    for t in last_user_terms:
        if any(h in t for h in _TOPIC_HINTS):
            entity = t
            break
    if not entity and last_user_terms:
        entity = last_user_terms[-1]

    if not entity:
        return query

    needs_rewrite = (
        _PRONOUNsubject.search(q) is not None
        or (len(q.split()) <= 4 and not any(h in q.lower() for h in _TOPIC_HINTS))
    )
    if not needs_rewrite:
        return query

    # Avoid duplicating the entity if already present.
    if entity.lower() in q.lower():
        return query

    rewritten = f"{q.rstrip('?.!')} for {entity}"
    logger.info("Query rewritten: %.40s → %.60s", query, rewritten)
    return rewritten


def split_multi_part(query: str) -> List[str]:
    """
    Split a multi-part question (spec §12): "what subjects are there, who can
    join, what is the duration and what are the fees?" → per-part sub-queries.
    Falls back to the full query when no clean split exists.
    """
    parts = [p.strip(" ?.,") for p in re.split(r"\band\b|\?|,|\balso\b|\bplus\b", query, flags=re.IGNORECASE) if p.strip(" ?.,")]
    # Keep splits only when they are meaningful (≥2 words each, ≤5 parts).
    parts = [p for p in parts if len(p.split()) >= 2]
    if 2 <= len(parts) <= 5:
        return parts
    return [query]


# ── Retrieval ────────────────────────────────────────────────────────────────

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
    conversation_history: Optional[List[Dict]] = None,
) -> List[Dict]:
    """
    Hybrid retrieval strictly isolated to this agent (spec §10):
    vector search + BM25 lexical search + RRF fusion + rerank.
    """
    from app.rag.reranker import rerank_chunks

    target_agent_id = agent_id or institute_id or 1
    store = vector_store_manager.get_store(target_agent_id)

    if not store.is_ready:
        logger.warning("Vector store not ready for agent %d", target_agent_id)
        return []

    if top_k is None:
        top_k = settings.TOP_K_RESULTS

    # 1. Query rewrite for follow-ups.
    effective_query = rewrite_query(query, conversation_history)

    cache_key = _get_cache_key(effective_query, top_k, min_score, target_agent_id)
    if cache_key in _query_cache:
        return _query_cache[cache_key]

    try:
        # 2. Multi-part splitting (spec §12).
        sub_queries = split_multi_part(effective_query)

        # 3. Hybrid search per sub-query, then merge.
        merged: Dict[int, Dict] = {}  # chunk index in store -> chunk dict
        for sq in sub_queries:
            sq_results = _hybrid_search(target_agent_id, sq, store, top_k)
            for chunk in sq_results:
                key = id(chunk)  # chunk dicts are copies; dedupe by text
                text_key = chunk.get("text", "")[:120]
                existing = next(
                    (m for m in merged.values() if m.get("text", "")[:120] == text_key),
                    None,
                )
                if existing:
                    existing["score"] = max(existing.get("score", 0), chunk.get("score", 0))
                    if chunk.get("bm25_rank") is not None:
                        existing["bm25_rank"] = chunk["bm25_rank"]
                else:
                    merged[id(chunk)] = chunk

        candidates = list(merged.values())

        # 4. Rerank + threshold.
        reranked = rerank_chunks(effective_query, candidates, top_k=top_k)
        filtered = [r for r in reranked if r.get("score", 0) >= min_score or r.get("bm25_rank") is not None]

        if len(_query_cache) >= _cache_max_size:
            _query_cache.pop(next(iter(_query_cache)), None)
        _query_cache[cache_key] = filtered

        logger.info(
            "Agent %d hybrid-retrieved %d chunks for query: %s (%d sub-queries)",
            target_agent_id, len(filtered), query[:40], len(sub_queries),
        )
        return filtered

    except Exception as e:
        logger.error("Agent %d retrieval failed: %s", target_agent_id, e)
        return []


def _hybrid_search(agent_id: int, query: str, store, top_k: int) -> List[Dict]:
    """One sub-query: vector search + BM25 search fused with RRF."""
    # Semantic search.
    query_embedding = generate_embedding(query)
    vector_results = store.search(query_embedding, top_k=max(top_k * 2, 8))

    # BM25 lexical search.
    bm25_results: List[Dict] = []
    bm25_entry = _get_bm25(agent_id)
    if bm25_entry:
        try:
            scores = bm25_entry["index"].get_scores(_tokenize(query))
            ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[: max(top_k * 2, 8)]
            bm25_results = []
            for idx, score in ranked:
                if score <= 0:
                    continue
                chunk = bm25_entry["chunks"][idx]
                bm25_results.append({
                    "text": chunk.get("text", ""),
                    "chunk_id": chunk.get("chunk_id", idx),
                    "source": chunk.get("source", "unknown"),
                    "agent_id": agent_id,
                    "score": min(score / 10.0, 1.0),  # normalized-ish for display
                    "bm25_rank": len(bm25_results),
                })
        except Exception as e:
            logger.debug("BM25 search failed for agent %d: %s", agent_id, e)

    # Reciprocal Rank Fusion.
    K = 60
    fused: Dict[int, Dict] = {}
    for rank, vr in enumerate(vector_results):
        text_key = vr.get("text", "")[:120]
        found = None
        for f in fused.values():
            if f.get("text", "")[:120] == text_key:
                found = f
                break
        if found:
            found["rrf"] = found.get("rrf", 0) + 1 / (K + rank + 1)
        else:
            c = dict(vr)
            c["rrf"] = 1 / (K + rank + 1)
            fused[id(vr)] = c

    for rank, br in enumerate(bm25_results):
        text_key = br.get("text", "")[:120]
        found = None
        for f in fused.values():
            if f.get("text", "")[:120] == text_key:
                found = f
                break
        if found:
            found["rrf"] = found.get("rrf", 0) + 1 / (K + rank + 1)
            found["bm25_rank"] = rank
        else:
            c = dict(br)
            c["rrf"] = 1 / (K + rank + 1)
            fused[id(br)] = c

    results = sorted(fused.values(), key=lambda c: c.get("rrf", 0), reverse=True)

    # The displayed "score" stays the semantic cosine; RRF drives ordering via
    # the reranker below. Attach bm25_rank where present.
    for r in results:
        if "bm25_rank" not in r:
            r["bm25_rank"] = None
    return results


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
