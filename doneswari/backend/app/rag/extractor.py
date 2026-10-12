import fitz  # PyMuPDF
import re
from pathlib import Path
from typing import List, Dict, Any


def extract_text_from_pdf(file_path: str) -> List[Dict[str, Any]]:
    """
    Extract text from PDF preserving page numbers and structure.
    Returns list of {page, text, headings} dicts.
    """
    doc = fitz.open(file_path)
    pages = []

    for page_num, page in enumerate(doc, start=1):
        blocks = page.get_text("dict")["blocks"]
        page_text_parts = []
        headings = []

        for block in blocks:
            if block["type"] == 0:  # text block
                for line in block["lines"]:
                    line_text = " ".join(span["text"] for span in line["spans"]).strip()
                    if not line_text:
                        continue
                    # Detect headings by font size
                    avg_size = sum(span["size"] for span in line["spans"]) / max(len(line["spans"]), 1)
                    if avg_size > 14 or (line["spans"] and line["spans"][0].get("flags", 0) & 2**4):
                        headings.append(line_text)
                    page_text_parts.append(line_text)

        text = "\n".join(page_text_parts)
        if text.strip():
            pages.append({
                "page": page_num,
                "text": text,
                "headings": headings
            })

    doc.close()
    return pages


def extract_text_from_txt(file_path: str) -> List[Dict[str, Any]]:
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    # Split into fake pages of ~1000 chars
    chunk_size = 1000
    pages = []
    for i, start in enumerate(range(0, len(text), chunk_size)):
        pages.append({
            "page": i + 1,
            "text": text[start:start + chunk_size],
            "headings": []
        })
    return pages


def extract_document(file_path: str, mime_type: str) -> List[Dict[str, Any]]:
    if mime_type == "application/pdf" or file_path.endswith(".pdf"):
        return extract_text_from_pdf(file_path)
    else:
        return extract_text_from_txt(file_path)
