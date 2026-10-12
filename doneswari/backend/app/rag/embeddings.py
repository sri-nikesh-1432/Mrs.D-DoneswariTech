import threading
import numpy as np
from typing import List
from sentence_transformers import SentenceTransformer
from app.config import settings

_model: SentenceTransformer | None = None
_lock = threading.Lock()


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = SentenceTransformer(settings.embedding_model)
    return _model


def embed_texts(texts: List[str]) -> np.ndarray:
    model = get_embedding_model()
    embeddings = model.encode(
        texts,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return embeddings


def embed_query(query: str) -> np.ndarray:
    model = get_embedding_model()
    embedding = model.encode(
        [query],
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    return embedding[0]
