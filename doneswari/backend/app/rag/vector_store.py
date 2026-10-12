import faiss
import pickle
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from app.config import settings


class AgentVectorStore:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.index_dir = settings.indexes_dir / f"agent_{agent_id}"
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.index: Optional[faiss.Index] = None
        self.chunks: List[Dict[str, Any]] = []
        self.dimension: int = 384  # all-MiniLM-L6-v2

    def build(self, chunks: List[Dict[str, Any]], embeddings: np.ndarray):
        self.chunks = chunks
        self.dimension = embeddings.shape[1]
        self.index = faiss.IndexFlatIP(self.dimension)  # Inner-product (cosine for normalised vecs)
        self.index.add(embeddings.astype(np.float32))
        self.save()

    def save(self):
        faiss.write_index(self.index, str(self.index_dir / "index.faiss"))
        with open(self.index_dir / "chunks.pkl", "wb") as f:
            pickle.dump(self.chunks, f)

    def load(self) -> bool:
        index_path = self.index_dir / "index.faiss"
        chunks_path = self.index_dir / "chunks.pkl"
        if index_path.exists() and chunks_path.exists():
            self.index = faiss.read_index(str(index_path))
            with open(chunks_path, "rb") as f:
                self.chunks = pickle.load(f)
            return True
        return False

    def search(self, query_embedding: np.ndarray, top_k: int = 5) -> List[Tuple[Dict[str, Any], float]]:
        if self.index is None or self.index.ntotal == 0:
            return []
        q = query_embedding.astype(np.float32).reshape(1, -1)
        scores, indices = self.index.search(q, min(top_k, self.index.ntotal))
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if 0 <= idx < len(self.chunks):
                results.append((self.chunks[idx], float(score)))
        return results

    @property
    def is_ready(self) -> bool:
        return self.index is not None and self.index.ntotal > 0


# In-process cache keyed by agent_id
_stores: Dict[str, AgentVectorStore] = {}


def get_vector_store(agent_id: str) -> AgentVectorStore:
    if agent_id not in _stores:
        store = AgentVectorStore(agent_id)
        store.load()
        _stores[agent_id] = store
    return _stores[agent_id]
