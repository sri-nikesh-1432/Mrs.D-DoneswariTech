import re
from typing import Dict, Any, List
from app.rag.retriever import retrieve


def extract_institution_profile(agent_id: str, all_chunks: List[Dict]) -> Dict[str, Any]:
    """
    Extract structured institution profile from chunks using regex patterns.
    """
    profile: Dict[str, Any] = {
        "institution_name": "",
        "institution_type": "",
        "location": "",
        "courses": [],
        "admissions_process": "",
        "fees": {},
        "eligibility": "",
        "scholarships": "",
        "hostel": "",
        "transport": "",
        "facilities": [],
        "placements": "",
        "safety": "",
        "contact": {},
        "faqs": [],
        "documents_required": [],
    }

    # Use first 10 chunks to find institution name
    all_text = " ".join(c["text"] for c in all_chunks[:10])

    name_patterns = [
        r'(?:Welcome to|About|ABOUT)\s+([A-Z][\w\s&]+(?:College|University|Institute|School|Academy|Institution))',
        r'^([A-Z][\w\s&]+(?:College|University|Institute|School|Academy))\s*$',
        r'([A-Z][\w\s&]+(?:College|University|Institute|School|Academy|Institution))\s+(?:is|was|was established)',
    ]
    for pattern in name_patterns:
        match = re.search(pattern, all_text, re.MULTILINE)
        if match:
            profile["institution_name"] = match.group(1).strip()
            break

    # Fallback: first heading-like line
    if not profile["institution_name"] and all_chunks:
        first_line = all_chunks[0]["text"].split("\n")[0].strip()
        if 5 < len(first_line) < 100:
            profile["institution_name"] = first_line

    # Extract courses
    course_chunks = [c for c in all_chunks if c.get("category") == "courses"]
    courses: set = set()
    course_patterns = [
        r'B\.?Tech\s+(?:in\s+)?([\w\s&]+)',
        r'M\.?Tech\s+(?:in\s+)?([\w\s&]+)',
        r'B\.?Sc\s+(?:in\s+)?([\w\s&]+)',
        r'MBA\s+(?:in\s+)?([\w\s&]+)',
        r'\b(BCA|MCA|B\.?Com|M\.?Com|BA|MA|B\.?E\.)\b',
    ]
    for chunk in course_chunks[:5]:
        for pattern in course_patterns:
            matches = re.findall(pattern, chunk["text"], re.IGNORECASE)
            for m in matches:
                if isinstance(m, str) and len(m) < 50:
                    courses.add(m.strip().title())
    profile["courses"] = list(courses)[:20]

    # Extract location
    location_chunks = [c for c in all_chunks if c.get("category") == "location"]
    if location_chunks:
        profile["location"] = location_chunks[0]["text"][:200]

    # Extract contact info
    contact_chunks = [c for c in all_chunks if c.get("category") == "contact"]
    if contact_chunks:
        text = contact_chunks[0]["text"]
        phone_match = re.search(r'(?:Phone|Tel|Mobile|Contact)[:\s]+([+\d\s\-]{7,20})', text, re.IGNORECASE)
        email_match = re.search(r'[\w.\-]+@[\w.\-]+\.\w+', text)
        if phone_match:
            profile["contact"]["phone"] = phone_match.group(1).strip()
        if email_match:
            profile["contact"]["email"] = email_match.group(0)

    return profile


def generate_faqs(agent_id: str) -> List[Dict[str, Any]]:
    """
    Generate FAQ list by running test questions against the RAG system.
    """
    test_questions = [
        "What courses are offered?",
        "What is the admission process?",
        "What are the fees?",
        "What is the eligibility criteria?",
        "Is hostel available?",
        "Are scholarships available?",
        "What documents are required for admission?",
        "What are the placement opportunities?",
        "Is transportation available?",
        "What facilities does the campus have?",
        "What is the campus safety like?",
        "How to apply for admission?",
    ]

    faqs = []
    for q in test_questions:
        chunks = retrieve(agent_id, q, top_k=1)
        if chunks and chunks[0]["score"] > 0.2:
            faqs.append({
                "question": q,
                "grounded": True,
                "source": f"{chunks[0]['section']} · Page {chunks[0]['page']}",
            })
        else:
            faqs.append({"question": q, "grounded": False, "source": None})

    return faqs
