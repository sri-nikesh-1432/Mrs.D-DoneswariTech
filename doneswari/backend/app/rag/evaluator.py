from typing import List, Dict, Any
from app.rag.retriever import retrieve


def evaluate_knowledge(agent_id: str, faqs: List[Dict[str, Any]]) -> float:
    """
    Evaluate knowledge quality based on FAQ grounding rate.
    Returns a 0-100 quality score.
    """
    if not faqs:
        return 0.0

    grounded = sum(1 for f in faqs if f.get("grounded", False))
    base_score = (grounded / len(faqs)) * 100

    # Bonus: check coverage across key topics
    coverage_queries = [
        ("courses", "What courses are available?"),
        ("fees", "What is the fee structure?"),
        ("admissions", "How to apply for admission?"),
        ("eligibility", "What is the eligibility criteria?"),
    ]
    bonus = 0
    for _cat, query in coverage_queries:
        results = retrieve(agent_id, query, top_k=1)
        if results and results[0]["score"] > 0.25:
            bonus += 2.5  # +2.5 per confirmed topic

    return min(round(base_score + bonus, 1), 100.0)
