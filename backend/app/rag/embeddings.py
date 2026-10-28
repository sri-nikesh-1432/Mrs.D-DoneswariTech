"""
Embedding Generator — Creates vector embeddings from text chunks.
Uses FastEmbed (ONNX Runtime, no torch) with instantaneous deterministic fallback
so the service NEVER hangs, OOMs, or blocks during RAG ingestion.
Dimension: 384-d, L2-normalized.
"""

from typing import List, Dict, Optional
import hashlib
import numpy as np
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

_model = None


def _deterministic_fallback_embeddings(texts: List[str], dim: int = 384) -> np.ndarray:
    """Instant, zero-dependency, normalized pseudo-embedding fallback.
    Hashes words and n-grams into a 384-d normalized vector.
    Guarantees embedding generation always completes in <50ms and never crashes."""
    matrix = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        words = t.lower().split()
        if not words:
            matrix[i, 0] = 1.0
            continue
        for w in words:
            h = int(hashlib.md5(w.encode("utf-8")).hexdigest(), 16)
            idx = h % dim
            sign = 1.0 if ((h >> 8) % 2 == 0) else -1.0
            matrix[i, idx] += sign
        norm = np.linalg.norm(matrix[i])
        if norm > 0:
            matrix[i] /= norm
        else:
            matrix[i, 0] = 1.0
    return matrix


class _FastEmbedEncoder:
    """Adapter exposing fastembed's TextEmbedding via the old .encode() API,
    returning L2-normalized float32 arrays of shape (n, dim)."""

    def __init__(self, backend):
        self._backend = backend

    def encode(
        self,
        texts,
        batch_size: int = 16,
        show_progress_bar: bool = False,
        convert_to_numpy: bool = True,
        normalize_embeddings: bool = True,
    ) -> np.ndarray:
        if isinstance(texts, str):
            texts = [texts]
        try:
            vectors = list(self._backend.embed(list(texts), batch_size=batch_size))
            arr = np.vstack(vectors).astype(np.float32).reshape(len(texts), -1)
            if normalize_embeddings:
                norms = np.linalg.norm(arr, axis=1, keepdims=True)
                arr = arr / np.maximum(norms, 1e-12)
            return arr
        except Exception as e:
            logger.warning("FastEmbed encode failed (%s), falling back to fast deterministic vector", e)
            return _deterministic_fallback_embeddings(list(texts), dim=384)


def _get_model():
    """Lazy-load the FastEmbed model with fallback."""
    global _model
    if _model is None:
        try:
            logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
            from fastembed import TextEmbedding
            model_name = settings.EMBEDDING_MODEL
            if model_name == "all-MiniLM-L6-v2":
                model_name = "sentence-transformers/all-MiniLM-L6-v2"
            _model = _FastEmbedEncoder(TextEmbedding(model_name=model_name))
            logger.info("Embedding model loaded successfully")
        except Exception as e:
            logger.warning("Failed to initialize FastEmbed (%s), using deterministic embedding fallback", e)
            _model = None
    return _model


def generate_embeddings(chunks: List[Dict]) -> np.ndarray:
    """
    Generate embeddings for a list of text chunks.
    Guaranteed to return an array of shape (len(chunks), 384) without hanging.
    """
    if not chunks:
        return np.empty((0, 384), dtype=np.float32)

    texts = [chunk.get("text", "") or " " for chunk in chunks]

    model = None
    try:
        model = _get_model()
    except Exception as e:
        logger.warning("Could not get embedding model (%s)", e)

    if model is not None:
        try:
            embeddings = model.encode(
                texts,
                batch_size=16,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )
            if embeddings.shape[0] == len(chunks) and not np.isnan(embeddings).any():
                return embeddings
        except Exception as e:
            logger.warning("FastEmbed generation failed (%s), using fallback", e)

    logger.info("Generating %d deterministic fallback embeddings", len(texts))
    return _deterministic_fallback_embeddings(texts, dim=384)


def generate_embedding(text: str) -> np.ndarray:
    """Generate embedding for a single text string."""
    arr = generate_embeddings([{"text": text}])
    return arr[0] if len(arr) > 0 else np.zeros((384,), dtype=np.float32)
