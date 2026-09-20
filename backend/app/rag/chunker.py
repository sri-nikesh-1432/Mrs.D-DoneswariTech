"""
Text Chunker — Structure-aware chunking for RAG ingestion.

The chunk count is ALWAYS `len(chunks)` produced from the REAL extracted
content. There is no target chunk count, no minimum, no maximum: a 3-page
PDF may produce 3 chunks, a 300-page PDF may produce 312. Chunking splits
only when a section/element exceeds the size budget — never arbitrarily.

Structure preservation (spec §6):
  - `--- Page N ---` markers from extraction become real page numbers
  - Heading-like lines become section titles carried on every chunk
  - Paragraph and list boundaries are respected before any hard split
  - Tables (repeating `|` rows) are kept inside a single chunk when possible
"""

import re
from typing import List, Dict, Optional
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)

# Heading heuristics: short line, no trailing period, optionally numbered
# ("2. Fee Structure", "ADMISSIONS", "Course Details:").
_HEADING_RE = re.compile(
    r"^(?:(?:chapter|section|unit|part)\s+\d+\s*[-:.]?\s*)?"
    r"(?:\d+(?:\.\d+)*[\.\)]\s+)?"
    r"[A-Z\u0C00-\u0C7F\u0900-\u097F][^.!?\n]{0,120}:?\s*$"
)

_PAGE_RE = re.compile(r"^\s*---\s*Page\s+(\d+)\s*---\s*$", re.IGNORECASE)
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")

# ~4 chars per token for English/Telugu mixed content; used for token_count
# metadata and size budgeting (spec: 500-1000 token chunks ≈ 2000-4000 chars,
# but we keep the configured character budget which defaults inside that band).
_CHARS_PER_TOKEN = 4


def _looks_like_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 140 or s.endswith((".", "?", "!", ",")):
        # Long prose or sentence endings are not headings.
        if not (s.endswith(":") and len(s) <= 140):
            return False
    return bool(_HEADING_RE.match(s))


class _PageBlock:
    """One extracted block: its text, source page, and enclosing section."""

    __slots__ = ("text", "page", "section")

    def __init__(self, text: str, page: Optional[int], section: Optional[str]):
        self.text = text
        self.page = page
        self.section = section


def _split_into_blocks(text: str) -> List[_PageBlock]:
    """Walk the cleaned extraction and produce page/section-attributed blocks.

    Paragraphs and table rows are grouped into blocks; headings open a new
    section; `--- Page N ---` markers set the page for subsequent content.
    """
    blocks: List[_PageBlock] = []
    current_page: Optional[int] = None
    current_section: Optional[str] = None
    buf: List[str] = []
    buf_has_table = False

    def _flush():
        nonlocal buf, buf_has_table
        joined = "\n".join(buf).strip()
        if joined:
            blocks.append(_PageBlock(joined, current_page, current_section))
        buf = []
        buf_has_table = False

    for raw_line in text.split("\n"):
        line = raw_line.rstrip()
        stripped = line.strip()

        m = _PAGE_RE.match(stripped)
        if m:
            _flush()
            current_page = int(m.group(1))
            continue

        if not stripped:
            # Blank line ends the current paragraph block.
            _flush()
            continue

        if _looks_like_heading(stripped):
            _flush()
            # A heading both opens a block (kept with its content) and sets
            # the section for the blocks that follow.
            blocks.append(_PageBlock(stripped, current_page, stripped[:200]))
            current_section = stripped[:200]
            continue

        is_table_row = bool(_TABLE_ROW_RE.match(stripped))
        if buf and is_table_row != buf_has_table:
            # Table started/ended inside a paragraph flow — split so tables
            # stay logically retrievable as their own unit.
            _flush()
        buf_has_table = is_table_row
        buf.append(stripped)

    _flush()
    return blocks


def chunk_text(
    text: str,
    chunk_size: int = None,
    chunk_overlap: int = None,
    source_document: str = "unknown",
) -> List[Dict]:
    """
    Structure-aware chunking of REAL extracted text.

    Returns a list of chunk dicts with metadata:
        text, chunk_id, source, page_number, section, token_count,
        character_count, start_page/end_page.

    The returned count is purely a function of the input content — calling
    this twice on the same text yields identical chunks (idempotent), and
    different documents yield different counts (no fixed number, spec §3).
    """
    logger.info("=== STEP 4: STRUCTURE-AWARE TEXT CHUNKING ===")
    logger.info("Source document: %s", source_document)

    if chunk_size is None:
        chunk_size = settings.CHUNK_SIZE
    if chunk_overlap is None:
        chunk_overlap = settings.CHUNK_OVERLAP

    if not text or not text.strip():
        logger.error("✗ Empty text provided for chunking")
        logger.error("STEP 4 FAILED: Cannot chunk empty text")
        return []

    logger.info("Chunk size: %d characters (overlap %d)", chunk_size, chunk_overlap)
    logger.info("Input text length: %d characters", len(text))
    logger.info("Input text preview (first 200 chars): %s", text[:200])

    blocks = _split_into_blocks(text)
    if not blocks:
        logger.error("STEP 4 FAILED: no content blocks parsed from extraction")
        return []
    logger.info(
        "Parsed %d content blocks across pages %s",
        len(blocks),
        sorted({b.page for b in blocks if b.page is not None}) or "n/a",
    )

    chunks: List[Dict] = []
    cur_parts: List[str] = []
    cur_len = 0
    cur_pages: set = set()
    cur_section: Optional[str] = None

    def _emit(parts: List[str], pages: set, section: Optional[str]):
        body = "\n\n".join(parts).strip()
        if not body:
            return
        chunks.append({
            "text": body,
            "chunk_id": len(chunks),
            "source": source_document,
            "page_number": min(pages) if pages else None,
            "end_page": max(pages) if pages else None,
            "section": section,
            "token_count": max(1, len(body) // _CHARS_PER_TOKEN),
            "character_count": len(body),
        })

    for block in blocks:
        block_len = len(block.text)
        # A block that fits joins the current chunk when it belongs to the
        # same section; a new section always opens a new chunk boundary.
        same_section = (block.section == cur_section) or (cur_section is None)
        fits = cur_len + block_len <= chunk_size

        if cur_parts and (not fits or not same_section):
            _emit(cur_parts, cur_pages, cur_section)
            # Carry a character-overlap tail from the previous chunk so
            # answers that straddle a boundary stay retrievable.
            tail = "\n\n".join(cur_parts)[-chunk_overlap:]
            overlap_parts = [tail] if tail.strip() else []
            cur_parts = overlap_parts
            cur_len = len(tail)
            cur_pages = set()
            cur_section = None

        if cur_section is None and block.section:
            cur_section = block.section
        cur_parts.append(block.text)
        cur_len += block_len
        if block.page is not None:
            cur_pages.add(block.page)

        # A single oversized block (huge table / wall of text) is split on
        # sentence/word boundaries — only when IT is oversized, never to hit
        # an arbitrary chunk count.
        while cur_len > chunk_size * 3:
            body = "\n\n".join(cur_parts)
            cut = body.rfind(". ", chunk_size // 2, chunk_size * 2)
            if cut <= 0:
                cut = body.rfind(" ", chunk_size // 2, chunk_size * 2)
            if cut <= 0:
                cut = chunk_size
            head = body[:cut].strip()
            rest = body[cut:].strip()
            _emit([head], cur_pages, cur_section)
            cur_parts = [rest]
            cur_len = len(rest)

    if cur_parts:
        _emit(cur_parts, cur_pages, cur_section)

    if not chunks:
        logger.error("STEP 4 FAILED: text produced zero chunks")
        return []

    # Hard guarantees (kept from the previous pipeline).
    empty_chunks = [i for i, c in enumerate(chunks) if not c.get("text", "").strip()]
    if empty_chunks:
        raise ValueError(f"Found {len(empty_chunks)} empty chunks")

    total_chars = sum(c["character_count"] for c in chunks)
    pages_covered = sorted({c["page_number"] for c in chunks if c["page_number"] is not None})
    logger.info("Total chunks created: %d (%d chars)", len(chunks), total_chars)
    logger.info("Pages covered: %s", pages_covered or "n/a")
    logger.info("Chunk previews (first 3):")
    for i, c in enumerate(chunks[:3]):
        logger.info(
            "  Chunk %d: ID=%d page=%s section=%r len=%d",
            i, c["chunk_id"], c["page_number"], (c["section"] or "")[:60], c["character_count"],
        )
    logger.info("=== STEP 4 COMPLETE: CHUNKING SUCCESSFUL ===")
    return chunks


def chunk_for_display(chunks: List[Dict]) -> List[Dict]:
    """Return chunks with truncated text for display purposes."""
    display = []
    for c in chunks:
        display.append({
            "chunk_id": c["chunk_id"],
            "source": c["source"],
            "page": c.get("page_number"),
            "section": c.get("section"),
            "preview": c["text"][:200] + "..." if len(c["text"]) > 200 else c["text"],
            "length": len(c["text"]),
        })
    return display
