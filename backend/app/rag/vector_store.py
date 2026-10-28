"""
FAISS Vector Store with Multi-Tenant Agent Isolation & Pure-NumPy Fallback.
Stores chunk embeddings and provides isolated similarity search per agent.
"""

import os
import pickle
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import numpy as np

try:
    import faiss
except Exception:
    faiss = None

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class VectorStore:
    """FAISS-based vector store with pure-NumPy cosine similarity fallback."""

    def __init__(self, agent_id: int = 1):
        self.agent_id = agent_id
        self.index = None
        self.embeddings: Optional[np.ndarray] = None
        self.chunks: List[Dict] = []
        self.dimension: int = 384  # all-MiniLM-L6-v2 dimension
        self.is_ready: bool = False

    def build_index(self, chunks: List[Dict], embeddings: np.ndarray) -> None:
        """Build FAISS index or NumPy fallback store from chunks and embeddings."""
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
        norm = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norm, 1e-12)
        self.embeddings = embeddings

        if faiss is not None:
            try:
                self.index = faiss.IndexFlatIP(dimension)
                self.index.add(embeddings)
            except Exception as e:
                logger.warning("FAISS indexing error (%s), using pure-NumPy store", e)
                self.index = None
        else:
            self.index = None

        self.chunks = chunks
        self.is_ready = True
        logger.info("Agent %d vector store ready (%d chunks)", self.agent_id, len(chunks))

    def append_chunks(self, chunks: List[Dict], embeddings: np.ndarray) -> None:
        """Append new chunks to this agent's existing index."""
        if len(chunks) == 0:
            return

        for chunk in chunks:
            chunk["agent_id"] = self.agent_id

        if not self.is_ready or (self.index is None and self.embeddings is None):
            self.build_index(chunks, embeddings)
            return

        norm = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norm, 1e-12)

        if faiss is not None and self.index is not None:
            try:
                self.index.add(embeddings)
            except Exception:
                pass

        if self.embeddings is not None:
            self.embeddings = np.vstack([self.embeddings, embeddings])
        else:
            self.embeddings = embeddings

        self.chunks.extend(chunks)
        logger.info("Agent %d vector store appended (%d new chunks, %d total)", self.agent_id, len(chunks), len(self.chunks))

    def search(self, query_embedding: np.ndarray, top_k: int = None) -> List[Dict]:
        """Search for most similar chunks to the query embedding."""
        if not self.is_ready or not self.chunks:
            return []

        if top_k is None:
            top_k = settings.TOP_K_RESULTS

        if query_embedding.ndim == 1:
            query_embedding = query_embedding.reshape(1, -1)

        norm = np.linalg.norm(query_embedding, axis=1, keepdims=True)
        query_embedding = query_embedding / np.maximum(norm, 1e-12)

        scores_list = []
        indices_list = []

        if faiss is not None and self.index is not None:
            try:
                scores, indices = self.index.search(query_embedding, min(top_k, len(self.chunks)))
                indices_list = indices[0]
                scores_list = scores[0]
            except Exception as e:
                logger.warning("FAISS search failed (%s), falling back to NumPy dot-product", e)
                indices_list = []

        if len(indices_list) == 0 and self.embeddings is not None:
            sims = np.dot(self.embeddings, query_embedding.T).flatten()
            k = min(top_k, len(self.chunks))
            indices_list = np.argsort(-sims)[:k]
            scores_list = sims[indices_list]

        results = []
        for i, idx in enumerate(indices_list):
            if idx < len(self.chunks):
                chunk = self.chunks[idx]
                score = float(scores_list[i]) if i < len(scores_list) else 0.8
                results.append({
                    "text": chunk.get("text", ""),
                    "chunk_id": chunk.get("chunk_id", idx),
                    "chunk_index": chunk.get("chunk_id", idx),
                    "source": chunk.get("source", "unknown"),
                    "document": chunk.get("source", "unknown"),
                    "page_number": chunk.get("page_number"),
                    "page": chunk.get("page_number"),
                    "section": chunk.get("section"),
                    "token_count": chunk.get("token_count"),
                    "character_count": chunk.get("character_count"),
                    "agent_id": self.agent_id,
                    "workspace_id": chunk.get("workspace_id"),
                    "score": score,
                })
        return results

    def save(self, path: str) -> None:
        """Save vector store and chunk metadata to disk."""
        if not self.is_ready:
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if faiss is not None and self.index is not None:
            try:
                faiss.write_index(self.index, f"{path}.index")
            except Exception:
                pass
        if self.embeddings is not None:
            try:
                np.save(f"{path}.npy", self.embeddings)
            except Exception:
                pass
        with open(f"{path}.chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)
        logger.info("Agent %d vector store saved to %s", self.agent_id, path)

    def load(self, path: str) -> bool:
        """Load vector store and chunk metadata from disk."""
        try:
            loaded_chunks = False
            if os.path.exists(f"{path}.chunks.pkl"):
                with open(f"{path}.chunks.pkl", "rb") as f:
                    self.chunks = pickle.load(f)
                loaded_chunks = True

            if os.path.exists(f"{path}.index") and faiss is not None:
                try:
                    self.index = faiss.read_index(f"{path}.index")
                    self.dimension = self.index.d
                except Exception:
                    self.index = None

            if os.path.exists(f"{path}.npy"):
                self.embeddings = np.load(f"{path}.npy")
                self.dimension = self.embeddings.shape[1]

            if loaded_chunks and (self.index is not None or self.embeddings is not None):
                self.is_ready = True
                logger.info("Agent %d vector store loaded from %s (%d chunks)", self.agent_id, path, len(self.chunks))
                return True
        except Exception as e:
            logger.error("Failed to load vector store from %s: %s", path, e)
        return False

    def clear(self) -> None:
        self.index = None
        self.embeddings = None
        self.chunks = []
        self.is_ready = False


class AgentVectorStoreManager:
    """Manages strictly isolated FAISS/NumPy vector stores per agent."""

    def __init__(self):
        self._stores: Dict[int, VectorStore] = {}

    def get_store(self, agent_id: int) -> VectorStore:
        if agent_id in self._stores:
            return self._stores[agent_id]

        store = VectorStore(agent_id=agent_id)
        agent_path = settings.BASE_DIR / "knowledge" / f"agent_{agent_id}" / "index"
        if os.path.exists(f"{agent_path}.index") or os.path.exists(f"{agent_path}.chunks.pkl"):
            store.load(str(agent_path))
        elif agent_id == 1:
            legacy_path = settings.BASE_DIR / "knowledge" / "knowledge_1"
            if os.path.exists(f"{legacy_path}.index") or os.path.exists(f"{legacy_path}.chunks.pkl"):
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
vector_store = vector_store_manager.get_store(1)
