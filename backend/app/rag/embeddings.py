"""
Embedding Generator — Creates vector embeddings from text chunks.
Uses Sentence Transformers (all-MiniLM-L6-v2) for local embedding generation.
"""

from typing import List, Dict, Optional
import numpy as np
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

_model = None


def _get_model():
    """Lazy-load the Sentence Transformer model."""
    global _model
    if _model is None:
        logger.info("Loading embedding model: %s", settings.EMBEDDING_MODEL)
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(settings.EMBEDDING_MODEL)
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
    if not chunks:
        logger.warning("No chunks provided for embedding generation")
        return np.array([])

    texts = [chunk["text"] for chunk in chunks]
    model = _get_model()

    logger.info("Generating embeddings for %d chunks...", len(texts))
    embeddings = model.encode(
        texts,
        batch_size=16,  # Smaller batch for faster processing
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # For cosine similarity
    )
    logger.info("Generated embeddings with shape %s", embeddings.shape)
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
