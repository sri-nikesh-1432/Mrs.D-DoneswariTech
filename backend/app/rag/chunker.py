"""
Text Chunker — Splits extracted text into overlapping chunks for embedding.
"""

import re
from typing import List, Dict
from app.config.settings import settings
from app.logs.logger import get_logger

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
    logger.info(f"=== STEP 4: TEXT CHUNKING ===")
    logger.info(f"Source document: {source_document}")
    
    if chunk_size is None:
        chunk_size = settings.CHUNK_SIZE
    if chunk_overlap is None:
        chunk_overlap = settings.CHUNK_OVERLAP

    logger.info(f"Chunk size: {chunk_size} characters")
    logger.info(f"Chunk overlap: {chunk_overlap} characters")
    logger.info(f"Input text length: {len(text)} characters")

    if not text or not text.strip():
        logger.error("✗ Empty text provided for chunking")
        logger.error("STEP 4 FAILED: Cannot chunk empty text")
        return []

    logger.info(f"Input text preview (first 200 chars): {text[:200]}")

    # Split into paragraphs first
    paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]
    logger.info(f"Paragraph count: {len(paragraphs)}")

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

    logger.info(f"Total chunks created: {len(chunks)}")
    
    # Verify no empty chunks
    empty_chunks = [i for i, c in enumerate(chunks) if not c.get("text") or not c["text"].strip()]
    if empty_chunks:
        logger.error(f"✗ Found {len(empty_chunks)} empty chunks at indices: {empty_chunks}")
        logger.error("STEP 4 FAILED: Empty chunks detected")
        raise ValueError(f"Found {len(empty_chunks)} empty chunks")
    
    logger.info("✓ No empty chunks detected")
    
    # Preview chunks
    logger.info("Chunk previews (first 3):")
    for i, chunk in enumerate(chunks[:3]):
        logger.info(f"  Chunk {i}: ID={chunk['chunk_id']}, Length={len(chunk['text'])}, Preview={chunk['text'][:100]}...")
    
    if len(chunks) > 3:
        logger.info(f"  ... and {len(chunks) - 3} more chunks")
    
    # Verify chunk IDs
    chunk_ids = [c["chunk_id"] for c in chunks]
    if chunk_ids != list(range(len(chunks))):
        logger.error(f"✗ Chunk IDs are not sequential: {chunk_ids}")
        logger.error("STEP 4 FAILED: Invalid chunk IDs")
        raise ValueError("Chunk IDs are not sequential")
    
    logger.info("✓ Chunk IDs are sequential and correct")
    
    logger.info(f"=== STEP 4 COMPLETE: CHUNKING SUCCESSFUL ===")
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
