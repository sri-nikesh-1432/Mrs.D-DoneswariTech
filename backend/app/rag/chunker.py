"""
Text Chunker — Splits extracted text into overlapping chunks for embedding.
"""

import re
from typing import List, Dict
from app.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def chunk_text(
    text: str,
    chunk_size: int = None,
    chunk_overlap: int = None,
    source_document: str = "unknown",
) -> List[Dict]:
    """
    Split text into overlapping chunks with metadata.
    
    Args:
        text: The extracted text to chunk
        chunk_size: Target characters per chunk (default from settings)
        chunk_overlap: Overlap between chunks (default from settings)
        source_document: Name of the source document
        
    Returns:
        List of dicts with keys: text, chunk_id, source, page (if available)
    """
    if chunk_size is None:
        chunk_size = settings.CHUNK_SIZE
    if chunk_overlap is None:
        chunk_overlap = settings.CHUNK_OVERLAP

    if not text or not text.strip():
        logger.warning("Empty text provided for chunking")
        return []

    # Split into paragraphs first
    paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    chunks = []
    current_chunk = ""
    current_pages = set()

    for para in paragraphs:
        # If adding this paragraph exceeds chunk size, finalize current chunk
        if len(current_chunk) + len(para) > chunk_size and current_chunk:
            chunks.append({
                "text": current_chunk.strip(),
                "chunk_id": len(chunks),
                "source": source_document,
            })
            # Start new chunk with overlap from end of previous chunk
            overlap_text = current_chunk[-chunk_overlap:] if len(current_chunk) > chunk_overlap else current_chunk
            current_chunk = overlap_text + "\n" + para
        else:
            if current_chunk:
                current_chunk += "\n\n" + para
            else:
                current_chunk = para

    # Don't forget the last chunk
    if current_chunk.strip():
        chunks.append({
            "text": current_chunk.strip(),
            "chunk_id": len(chunks),
            "source": source_document,
        })

    logger.info(
        "Chunked %d chars into %d chunks (size=%d, overlap=%d)",
        len(text), len(chunks), chunk_size, chunk_overlap
    )
    return chunks


def chunk_for_display(chunks: List[Dict]) -> List[Dict]:
    """Return chunks with truncated text for display purposes."""
    display = []
    for c in chunks:
        display.append({
            "chunk_id": c["chunk_id"],
            "source": c["source"],
            "preview": c["text"][:200] + "..." if len(c["text"]) > 200 else c["text"],
            "length": len(c["text"]),
        })
    return display
