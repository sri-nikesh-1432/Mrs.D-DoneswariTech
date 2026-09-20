"""
Embedding Generator — Creates vector embeddings from text chunks.
Uses FastEmbed (ONNX Runtime, no torch) for local embedding generation so the
service runs comfortably inside small/512MB containers. Model stays the same
all-MiniLM-L6-v2 (384-d, L2-normalized) so existing vector stores keep working.
"""

from typing import List, Dict, Optional
import numpy as np
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

_model = None


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
        vectors = list(self._backend.embed(list(texts), batch_size=batch_size))
        arr = np.vstack(vectors).astype(np.float32).reshape(len(texts), -1)
        if normalize_embeddings:
            norms = np.linalg.norm(arr, axis=1, keepdims=True)
            arr = arr / np.maximum(norms, 1e-12)
        return arr


def _get_model():
    """Lazy-load the FastEmbed model for all-MiniLM-L6-v2 (ONNX, no torch)."""
    global _model
    if _model is None:
        logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
        from fastembed import TextEmbedding
        model_name = settings.EMBEDDING_MODEL
        if model_name == "all-MiniLM-L6-v2":
            model_name = "sentence-transformers/all-MiniLM-L6-v2"
        _model = _FastEmbedEncoder(TextEmbedding(model_name=model_name))
        logger.info("Embedding model loaded successfully")
    return _model


def generate_embeddings(chunks: List[Dict]) -> np.ndarray:
    """
    Generate embeddings for a list of text chunks.
    
    Args:
        chunks: List of dicts with 'text' key
        
    Returns:
        numpy array of embeddings, shape (n_chunks, embedding_dim)
    """
    logger.info(f"=== STEP 5: EMBEDDING GENERATION ===")
    logger.info(f"Number of chunks: {len(chunks)}")
    
    if not chunks:
        logger.error("✗ No chunks provided for embedding generation")
        logger.error("STEP 5 FAILED: Cannot generate embeddings from empty chunks")
        return np.array([])

    # Verify all chunks have text
    chunks_without_text = [i for i, c in enumerate(chunks) if not c.get("text") or not c["text"].strip()]
    if chunks_without_text:
        logger.error(f"✗ Found {len(chunks_without_text)} chunks without text at indices: {chunks_without_text}")
        logger.error("STEP 5 FAILED: Cannot embed chunks without text")
        raise ValueError(f"Found {len(chunks_without_text)} chunks without text")
    
    logger.info("✓ All chunks have text content")
    
    texts = [chunk["text"] for chunk in chunks]
    logger.info(f"Total text length to embed: {sum(len(t) for t in texts)} characters")
    logger.info(f"Average chunk length: {sum(len(t) for t in texts) / len(texts):.2f} characters")
    
    model = _get_model()
    logger.info(f"Model loaded: {settings.EMBEDDING_MODEL}")

    logger.info(f"Generating embeddings for {len(texts)} chunks...")
    embeddings = model.encode(
        texts,
        batch_size=16,  # Smaller batch for faster processing
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # For cosine similarity
    )
    
    logger.info(f"Generated embeddings with shape: {embeddings.shape}")
    logger.info(f"Embedding dimension: {embeddings.shape[1] if len(embeddings.shape) > 1 else 'unknown'}")
    logger.info(f"Number of embeddings: {embeddings.shape[0]}")
    
    # Verify embedding count matches chunk count
    if embeddings.shape[0] != len(chunks):
        logger.error(f"✗ Embedding count {embeddings.shape[0]} does not match chunk count {len(chunks)}")
        logger.error("STEP 5 FAILED: Embedding count mismatch")
        raise ValueError(f"Embedding count {embeddings.shape[0]} does not match chunk count {len(chunks)}")
    
    logger.info("✓ Embedding count matches chunk count")
    
    # Verify no NaN embeddings
    nan_count = np.isnan(embeddings).sum()
    if nan_count > 0:
        logger.error(f"✗ Found {nan_count} NaN values in embeddings")
        logger.error("STEP 5 FAILED: NaN values detected in embeddings")
        raise ValueError(f"Found {nan_count} NaN values in embeddings")
    
    logger.info("✓ No NaN values in embeddings")
    
    # Verify no zero embeddings
    zero_count = (embeddings == 0).all(axis=1).sum()
    if zero_count > 0:
        logger.error(f"✗ Found {zero_count} zero embeddings")
        logger.error("STEP 5 FAILED: Zero embeddings detected")
        raise ValueError(f"Found {zero_count} zero embeddings")
    
    logger.info("✓ No zero embeddings")
    
    logger.info(f"=== STEP 5 COMPLETE: EMBEDDING GENERATION SUCCESSFUL ===")
    return embeddings


def generate_embedding(text: str) -> np.ndarray:
    """Generate embedding for a single text string."""
    model = _get_model()
    embedding = model.encode(
        text,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    return embedding
