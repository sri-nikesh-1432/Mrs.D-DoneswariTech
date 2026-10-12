from typing import List, Dict, Any
from app.rag.embeddings import embed_query
from app.rag.vector_store import get_vector_store
from app.config import settings


def retrieve(agent_id: str, query: str, top_k: int = None) -> List[Dict[str, Any]]:
    """
    Retrieve relevant chunks for a query.
    Returns list of {text, page, section, category, score} dicts.
    """
    if top_k is None:
        top_k = settings.top_k_results

    store = get_vector_store(agent_id)
    if not store.is_ready:
        return []

    query_embedding = embed_query(query)
    raw_results = store.search(query_embedding, top_k=top_k * 2)  # over-retrieve then filter

    # Light rerank: small boost when the chunk category word appears in the query
    scored = []
    query_lower = query.lower()
    for chunk, score in raw_results:
        boost = 0.05 if chunk.get("category", "") in query_lower else 0.0
        scored.append((chunk, score + boost))

    scored.sort(key=lambda x: x[1], reverse=True)

    return [
        {
            "text": chunk["text"],
            "page": chunk.get("page", 0),
            "section": chunk.get("section", ""),
            "category": chunk.get("category", "general"),
            "score": round(score, 3),
        }
        for chunk, score in scored[:top_k]
        if score > 0.1  # minimum relevance threshold
    ]


def build_context(retrieved_chunks: List[Dict[str, Any]], max_chars: int = 3000) -> str:
    """
    Build context string from retrieved chunks for the LLM prompt.
    """
    if not retrieved_chunks:
        return ""

    context_parts = []
    total_chars = 0

    for chunk in retrieved_chunks:
        chunk_text = f"[{chunk['section']} | Page {chunk['page']}]\n{chunk['text']}"
        if total_chars + len(chunk_text) > max_chars:
            break
        context_parts.append(chunk_text)
        total_chars += len(chunk_text)

    return "\n\n".join(context_parts)
