"""
FAISS Vector Store — Stores chunk embeddings and provides similarity search.
"""

import os
import pickle
from typing import List, Dict, Optional, Tuple
import numpy as np
import faiss

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class VectorStore:
    """FAISS-based vector store for RAG."""

    def __init__(self):
        self.index: Optional[faiss.Index] = None
        self.chunks: List[Dict] = []
        self.dimension: int = 384  # all-MiniLM-L6-v2 dimension
        self.is_ready: bool = False

    def build_index(self, chunks: List[Dict], embeddings: np.ndarray) -> None:
        """
        Build FAISS index from chunks and their embeddings.
        
        Args:
            chunks: List of chunk dicts with metadata
            embeddings: numpy array of shape (n_chunks, embedding_dim)
        """
        if len(chunks) == 0:
            logger.warning("No chunks to index")
            return

        dimension = embeddings.shape[1]
        self.dimension = dimension

        # Normalize embeddings for cosine similarity
        faiss.normalize_L2(embeddings)

        # Create index
        self.index = faiss.IndexFlatIP(dimension)  # Inner product = cosine similarity on normalized vectors
        self.index.add(embeddings)
        self.chunks = chunks
        self.is_ready = True

        logger.info(
            "FAISS index built: %d chunks, dim=%d",
            len(chunks), dimension,
        )

    def search(self, query_embedding: np.ndarray, top_k: int = None) -> List[Dict]:
        """
        Search for most similar chunks to the query embedding.
        
        Args:
            query_embedding: Query embedding vector (1D or 2D array)
            top_k: Number of results to return (default from settings)
            
        Returns:
            List of dicts with chunk data and similarity scores
        """
        if not self.is_ready or self.index is None:
            logger.warning("Vector store not ready for search")
            return []

        if top_k is None:
            top_k = settings.TOP_K_RETRIEVAL

        # Ensure 2D array
        if query_embedding.ndim == 1:
            query_embedding = query_embedding.reshape(1, -1)

        # Normalize query
        faiss.normalize_L2(query_embedding)

        # Search
        scores, indices = self.index.search(query_embedding, min(top_k, len(self.chunks)))

        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.chunks):
                chunk = self.chunks[idx]
                results.append({
                    "text": chunk["text"],
                    "chunk_id": chunk["chunk_id"],
                    "source": chunk.get("source", "unknown"),
                    "score": float(scores[0][i]),
                })

        return results

    def save(self, path: str) -> None:
        """Save the vector store to disk."""
        if not self.is_ready:
            logger.warning("Cannot save empty vector store")
            return

        os.makedirs(os.path.dirname(path), exist_ok=True)

        # Save FAISS index
        faiss.write_index(self.index, f"{path}.index")
        # Save chunks
        with open(f"{path}.chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)

        logger.info("Vector store saved to %s", path)

    def load(self, path: str) -> bool:
        """Load the vector store from disk. Returns True if successful."""
        try:
            if os.path.exists(f"{path}.index") and os.path.exists(f"{path}.chunks.pkl"):
                self.index = faiss.read_index(f"{path}.index")
                with open(f"{path}.chunks.pkl", "rb") as f:
                    self.chunks = pickle.load(f)
                self.dimension = self.index.d
                self.is_ready = True
                logger.info("Vector store loaded from %s (%d chunks)", path, len(self.chunks))
                return True
        except Exception as e:
            logger.error("Failed to load vector store: %s", e)
        return False

    def clear(self) -> None:
        """Clear the vector store."""
        self.index = None
        self.chunks = []
        self.is_ready = False
        logger.info("Vector store cleared")


# Global singleton vector store
vector_store = VectorStore()
