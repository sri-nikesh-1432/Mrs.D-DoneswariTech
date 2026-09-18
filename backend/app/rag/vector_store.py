"""
FAISS Vector Store with Multi-Tenant Agent Isolation.
Stores chunk embeddings and provides isolated similarity search per agent.
"""

import os
import pickle
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import numpy as np
import faiss

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class VectorStore:
    """FAISS-based vector store for RAG."""

    def __init__(self, agent_id: int = 1):
        self.agent_id = agent_id
        self.index: Optional[faiss.Index] = None
        self.chunks: List[Dict] = []
        self.dimension: int = 384  # all-MiniLM-L6-v2 dimension
        self.is_ready: bool = False

    def build_index(self, chunks: List[Dict], embeddings: np.ndarray) -> None:
        """Build FAISS index from chunks and their embeddings."""
        if len(chunks) == 0:
            logger.error("Cannot build index with empty chunks")
            return

        if len(chunks) != embeddings.shape[0]:
            raise ValueError(f"Chunk count {len(chunks)} does not match embedding count {embeddings.shape[0]}")

        dimension = embeddings.shape[1]
        self.dimension = dimension

        # Tag chunks with agent_id
        for chunk in chunks:
            chunk["agent_id"] = self.agent_id

        # Normalize embeddings for cosine similarity
        faiss.normalize_L2(embeddings)

        # Inner product = cosine similarity on normalized vectors
        self.index = faiss.IndexFlatIP(dimension)
        self.index.add(embeddings)
        self.chunks = chunks
        self.is_ready = True
        logger.info("Agent %d vector store ready (%d chunks)", self.agent_id, len(chunks))

    def search(self, query_embedding: np.ndarray, top_k: int = None) -> List[Dict]:
        """Search for most similar chunks to the query embedding."""
        if not self.is_ready or self.index is None:
            return []

        if top_k is None:
            top_k = settings.TOP_K_RESULTS

        if query_embedding.ndim == 1:
            query_embedding = query_embedding.reshape(1, -1)

        faiss.normalize_L2(query_embedding)
        scores, indices = self.index.search(query_embedding, min(top_k, len(self.chunks)))

        results = []
        for i, idx in enumerate(indices[0]):
            if idx < len(self.chunks):
                chunk = self.chunks[idx]
                results.append({
                    "text": chunk["text"],
                    "chunk_id": chunk.get("chunk_id", idx),
                    "source": chunk.get("source", "unknown"),
                    "agent_id": self.agent_id,
                    "score": float(scores[0][i]),
                })
        return results

    def save(self, path: str) -> None:
        """Save FAISS index and chunk metadata to disk."""
        if not self.is_ready or self.index is None:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        faiss.write_index(self.index, f"{path}.index")
        with open(f"{path}.chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)
        logger.info("Agent %d vector store saved to %s", self.agent_id, path)

    def load(self, path: str) -> bool:
        """Load FAISS index and chunk metadata from disk."""
        try:
            if os.path.exists(f"{path}.index") and os.path.exists(f"{path}.chunks.pkl"):
                self.index = faiss.read_index(f"{path}.index")
                with open(f"{path}.chunks.pkl", "rb") as f:
                    self.chunks = pickle.load(f)
                self.dimension = self.index.d
                self.is_ready = True
                logger.info("Agent %d vector store loaded from %s (%d chunks)", self.agent_id, path, len(self.chunks))
                return True
        except Exception as e:
            logger.error("Failed to load vector store from %s: %s", path, e)
        return False

    def clear(self) -> None:
        self.index = None
        self.chunks = []
        self.is_ready = False


class AgentVectorStoreManager:
    """Manages strictly isolated FAISS vector stores per agent."""

    def __init__(self):
        self._stores: Dict[int, VectorStore] = {}

    def get_store(self, agent_id: int) -> VectorStore:
        if agent_id in self._stores:
            return self._stores[agent_id]

        store = VectorStore(agent_id=agent_id)
        # Check standard path: knowledge/agent_{agent_id}/index
        agent_path = settings.BASE_DIR / "knowledge" / f"agent_{agent_id}" / "index"
        if os.path.exists(f"{agent_path}.index"):
            store.load(str(agent_path))
        elif agent_id == 1:
            # Check legacy path: knowledge/knowledge_1
            legacy_path = settings.BASE_DIR / "knowledge" / "knowledge_1"
            if os.path.exists(f"{legacy_path}.index"):
                store.load(str(legacy_path))

        self._stores[agent_id] = store
        return store

    def save_store(self, agent_id: int, chunks: List[Dict], embeddings: np.ndarray) -> VectorStore:
        store = VectorStore(agent_id=agent_id)
        store.build_index(chunks, embeddings)
        save_path = settings.BASE_DIR / "knowledge" / f"agent_{agent_id}" / "index"
        store.save(str(save_path))
        self._stores[agent_id] = store
        return store


vector_store_manager = AgentVectorStoreManager()
# Global default vector store for backward compatibility
vector_store = vector_store_manager.get_store(1)
