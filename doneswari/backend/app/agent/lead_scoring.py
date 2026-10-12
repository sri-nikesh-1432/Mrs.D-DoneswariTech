from typing import Dict, Any


def classify_lead(memory: Dict[str, Any]) -> str:
    signals = memory.get("lead_signals", [])
    hot_keywords = ["how to apply", "deadline", "application form", "want to join", "how do i enroll"]

    hot_count = sum(1 for s in signals if any(h in s for h in hot_keywords))

    if hot_count >= 2:
        return "hot"
    elif hot_count >= 1:
        return "warm"
    elif memory.get("fee_concern") or memory.get("hostel_needed") or memory.get("course_interest"):
        return "warm"
    elif len(memory.get("topics_discussed", [])) > 2:
        return "cold"
    else:
        return "unknown"
