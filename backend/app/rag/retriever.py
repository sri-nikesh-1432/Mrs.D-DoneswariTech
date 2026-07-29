"""
RAG Retriever — Given a query, retrieves the most relevant knowledge chunks.
"""

from typing import List, Dict, Optional
from app.rag.embeddings import generate_embedding
from app.rag.vector_store import vector_store
from app.logs.logger import get_logger

logger = get_logger(__name__)


async def retrieve_context(
    query: str,
    top_k: int = None,
    min_score: float = 0.3,
) -> List[Dict]:
    """
    Retrieve the most relevant knowledge chunks for a query.
    
    Args:
        query: The question or query text
        top_k: Number of chunks to retrieve
        min_score: Minimum similarity score threshold
        
    Returns:
        List of relevant chunks with text, source, and score
    """
    if not vector_store.is_ready:
        logger.warning("Vector store not ready — no context available")
        return []

    try:
        # Generate query embedding
        query_embedding = generate_embedding(query)

        # Search vector store
        results = vector_store.search(query_embedding, top_k=top_k)

        # Filter by minimum score
        filtered = [r for r in results if r["score"] >= min_score]

        logger.info(
            "Retrieved %d/%d chunks for query (min_score=%.2f)",
            len(filtered), len(results), min_score,
        )
        return filtered

    except Exception as e:
        logger.error("Retrieval failed: %s", e)
        return []


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
