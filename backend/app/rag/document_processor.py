"""
Document Processor — Extract text and REAL metadata from uploaded files.
Supports: PDF, DOCX, TXT, CSV, XLSX, XLS

Every extraction returns an `ExtractionResult` carrying measured facts:
page_count, character/word counts, extraction method, and per-page previews.
If a PDF yields zero usable text (scanned/image PDF without OCR), extraction
FAILS loudly — training must never continue on empty content (spec §5).
"""

import os
import re
import traceback
from dataclasses import dataclass, field
from typing import List, Optional
import pandas as pd

from app.logs.logger import get_logger

logger = get_logger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv", ".xlsx", ".xls"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@dataclass
class ExtractionResult:
    """REAL measured extraction facts — stored on the Knowledge row."""

    text: str
    page_count: int = 0
    extracted_character_count: int = 0
    extracted_word_count: int = 0
    extraction_method: str = "unknown"
    extraction_status: str = "success"
    extraction_error: Optional[str] = None
    page_previews: List[dict] = field(default_factory=list)


def validate_file(filename: str, file_size: int) -> tuple[bool, str]:
    """Validate file type and size. Returns (is_valid, error_message)."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
    if file_size > MAX_FILE_SIZE:
        return False, f"File too large: {file_size / 1024 / 1024:.1f} MB. Max: 50 MB"
    if file_size == 0:
        return False, "File is empty"
    return True, ""


def _page_preview(text: str, page_num: int, max_chars: int = 400) -> dict:
    t = text.strip()
    return {
        "page": page_num,
        "characters": len(t),
        "preview": t[:max_chars] if t else "(no extractable text on this page)",
    }


def _extract_pdf_detailed(file_path: str) -> ExtractionResult:
    """Extract text from PDF page-by-page with real page metadata.

    Detects scanned/image PDFs (zero text on every page) and fails instead
    of pretending extraction succeeded.
    """
    import fitz  # PyMuPDF

    doc = fitz.open(file_path)
    try:
        page_count = doc.page_count
        pages: List[tuple[int, str]] = []
        for page_num, page in enumerate(doc, start=1):
            page_text = page.get_text() or ""
            pages.append((page_num, page_text))
    finally:
        doc.close()

    usable_pages = [(n, t) for n, t in pages if t.strip()]
    if not usable_pages:
        raise ValueError(
            f"PDF has {page_count} page(s) but NO extractable text — it is likely a "
            "scanned/image PDF. Use OCR before uploading, or upload a text-based document."
        )

    # Page-attributed text that the chunker parses back into page numbers.
    parts = [f"--- Page {n} ---\n{t.strip()}" for n, t in usable_pages]
    text = "\n\n".join(parts)
    full_for_stats = "\n".join(t for _, t in usable_pages)

    previews = [_page_preview(t, n) for n, t in usable_pages[:10]]
    return ExtractionResult(
        text=text,
        page_count=page_count,
        extracted_character_count=len(full_for_stats.strip()),
        extracted_word_count=len(full_for_stats.split()),
        extraction_method="pymupdf_text",
        extraction_status="success",
        page_previews=previews,
    )


def _extract_docx_detailed(file_path: str) -> ExtractionResult:
    """Extract DOCX paragraphs + tables."""
    from docx import Document

    doc = Document(file_path)
    text_parts: List[str] = []
    for para in doc.paragraphs:
        if para.text.strip():
            text_parts.append(para.text)
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text for cell in row.cells)
            if row_text.strip():
                text_parts.append(row_text)
    text = "\n".join(text_parts)
    return ExtractionResult(
        text=text,
        page_count=max(1, len(text) // 3000) if text else 0,  # DOCX has no real pages
        extracted_character_count=len(text.strip()),
        extracted_word_count=len(text.split()),
        extraction_method="python_docx",
        extraction_status="success",
    )


def _extract_txt_detailed(file_path: str) -> ExtractionResult:
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    return ExtractionResult(
        text=text,
        page_count=1,
        extracted_character_count=len(text.strip()),
        extracted_word_count=len(text.split()),
        extraction_method="plain_text",
        extraction_status="success",
    )


def _extract_csv_detailed(file_path: str) -> ExtractionResult:
    df = pd.read_csv(file_path)
    parts = [" | ".join(str(col) for col in df.columns)]
    for _, row in df.iterrows():
        parts.append(" | ".join(str(val) for val in row))
    text = "\n".join(parts)
    return ExtractionResult(
        text=text,
        page_count=1,
        extracted_character_count=len(text.strip()),
        extracted_word_count=len(text.split()),
        extraction_method="pandas_csv",
        extraction_status="success",
    )


def _extract_excel_detailed(file_path: str) -> ExtractionResult:
    xls = pd.ExcelFile(file_path)
    parts: List[str] = []
    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name)
        parts.append(f"--- Sheet: {sheet_name} ---")
        for _, row in df.iterrows():
            row_items = [f"{col}: {val}" for col, val in row.items() if pd.notna(val)]
            if row_items:
                parts.append(" | ".join(row_items))
    text = "\n".join(parts)
    return ExtractionResult(
        text=text,
        page_count=len(xls.sheet_names),
        extracted_character_count=len(text.strip()),
        extracted_word_count=len(text.split()),
        extraction_method="pandas_excel",
        extraction_status="success",
    )


def _extractors():
    return {
        ".pdf": _extract_pdf_detailed,
        ".docx": _extract_docx_detailed,
        ".txt": _extract_txt_detailed,
        ".csv": _extract_csv_detailed,
        ".xlsx": _extract_excel_detailed,
        ".xls": _extract_excel_detailed,
    }


def extract_text_detailed(file_path: str, filename: str) -> ExtractionResult:
    """Extract text + real metadata from any supported file. Raises on failure."""
    ext = os.path.splitext(filename)[1].lower()
    logger.info("Extracting text from %s (%s)", filename, ext)

    extractor = _extractors().get(ext)
    if extractor is None:
        raise ValueError(f"Unsupported file type: {ext}")

    try:
        result = extractor(file_path)
    except ValueError:
        raise  # scanned-PDF style errors pass through untouched
    except Exception as e:
        logger.error(
            "Failed to extract text from %s: %s\n%s", filename, e, traceback.format_exc()
        )
        raise ValueError(f"Extraction failed for {filename}: {e}") from e

    result.text = clean_text(result.text)
    if not result.text.strip():
        result.extraction_status = "failed"
        result.extraction_error = "No usable text after cleaning"
        raise ValueError(
            f"{filename} contains no extractable text content — training aborted."
        )

    logger.info(
        "Extracted %d chars / %d words / %d pages from %s via %s",
        result.extracted_character_count,
        result.extracted_word_count,
        result.page_count,
        filename,
        result.extraction_method,
    )
    return result


async def extract_text(file_path: str, filename: str) -> str:
    """Backward-compatible plain-text extraction (used by older routes)."""
    return extract_text_detailed(file_path, filename).text


def clean_text(text: str) -> str:
    """Clean extracted text by removing artifacts."""
    text = text.replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"\n\s*\d+\s*\n", "\n", text)
    import unicodedata
    text = unicodedata.normalize("NFKC", text)
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(lines).strip()
