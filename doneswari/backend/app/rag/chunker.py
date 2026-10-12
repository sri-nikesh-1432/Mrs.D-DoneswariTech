import re
from typing import List, Dict, Any

SECTION_KEYWORDS: Dict[str, List[str]] = {
    "courses": ["course", "programme", "program", "b.tech", "m.tech", "bca", "mca", "bsc", "msc", "degree", "branch", "stream", "specialization"],
    "admissions": ["admission", "apply", "application", "enroll", "enrollment", "selection", "merit", "entrance"],
    "eligibility": ["eligibility", "eligible", "qualify", "qualification", "minimum", "criteria", "requirement", "marks", "percentage", "10+2", "12th", "jee", "eamcet"],
    "fees": ["fee", "fees", "tuition", "payment", "cost", "rupees", "₹", "annual fee", "semester fee"],
    "scholarships": ["scholarship", "merit scholarship", "financial aid", "concession", "discount", "waiver", "bursary"],
    "hostel": ["hostel", "accommodation", "dormitory", "residential", "boarding", "room", "mess"],
    "transport": ["transport", "bus", "shuttle", "vehicle", "commute", "pickup"],
    "placements": ["placement", "career", "job", "recruit", "company", "hiring", "campus placement", "package", "salary"],
    "safety": ["safety", "security", "cctv", "guard", "safe", "protection", "surveillance"],
    "faculty": ["faculty", "professor", "teacher", "staff", "lecturer", "phd", "experienced"],
    "facilities": ["facility", "facilities", "lab", "library", "sports", "gymnasium", "canteen", "wifi", "infrastructure"],
    "contact": ["contact", "phone", "email", "address", "website", "helpline"],
    "location": ["located", "location", "campus", "city", "state", "district", "near"],
    "documents_required": ["documents", "certificate", "marksheet", "id proof", "photo", "transfer certificate", "tc"],
    "faq": ["frequently asked", "faq", "question", "answer"],
}


def detect_category(text: str, section: str) -> str:
    combined = (text + " " + section).lower()
    scores: Dict[str, int] = {}
    for category, keywords in SECTION_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in combined)
        if score > 0:
            scores[category] = score
    return max(scores, key=scores.get) if scores else "general"


def detect_section(text: str, headings: List[str]) -> str:
    if headings:
        return headings[0][:100]
    first_line = text.split("\n")[0][:100]
    return first_line if len(first_line) > 5 else "General Information"


def create_chunks(
    pages: List[Dict[str, Any]],
    document_id: str,
    chunk_size: int = 800,
    overlap: int = 150,
) -> List[Dict[str, Any]]:
    """
    Create semantic chunks from cleaned pages with metadata.
    """
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for page in pages:
        text = page["text"]
        page_num = page["page"]
        headings = page.get("headings", [])

        paragraphs = re.split(r'\n{2,}|(?<=\.)\s+(?=[A-Z])', text)
        current_chunk = ""
        current_section = detect_section(text, headings)

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            if len(current_chunk) + len(para) > chunk_size and current_chunk:
                category = detect_category(current_chunk, current_section)
                chunks.append({
                    "chunk_id": f"chunk_{chunk_index:04d}",
                    "document_id": document_id,
                    "chunk_index": chunk_index,
                    "text": current_chunk.strip(),
                    "page": page_num,
                    "section": current_section,
                    "category": category,
                    "token_count": len(current_chunk.split()),
                })
                chunk_index += 1
                overlap_text = current_chunk[-overlap:] if len(current_chunk) > overlap else current_chunk
                current_chunk = overlap_text + " " + para
            else:
                current_chunk = (current_chunk + " " + para).strip() if current_chunk else para

            # Update section if we see an ALL-CAPS heading-like short line
            if len(para) < 100 and para.isupper():
                current_section = para

        # Flush remaining
        if current_chunk.strip():
            category = detect_category(current_chunk, current_section)
            chunks.append({
                "chunk_id": f"chunk_{chunk_index:04d}",
                "document_id": document_id,
                "chunk_index": chunk_index,
                "text": current_chunk.strip(),
                "page": page_num,
                "section": current_section,
                "category": category,
                "token_count": len(current_chunk.split()),
            })
            chunk_index += 1

    return chunks
