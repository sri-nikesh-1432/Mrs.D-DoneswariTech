from typing import Optional

OBJECTION_KEYWORDS: dict = {
    "too_expensive": ["expensive", "too much", "fee is high", "can't afford", "costly"],
    "not_interested": ["not interested", "don't want", "no thanks", "not for us"],
    "need_to_discuss": ["discuss with", "talk to", "consult", "parents", "family"],
    "need_time": ["need time", "think about", "not sure yet", "later", "will decide"],
    "comparing_colleges": ["other college", "comparing", "other options", "looking at"],
    "distance": ["far", "distance", "too far", "location", "far from home"],
    "hostel_concern": ["hostel safe", "girls hostel", "hostel facility"],
    "safety_concern": ["safe", "safety", "security"],
    "placement_concern": ["placement", "job", "career after"],
    "course_concern": ["not sure about course", "wrong course", "different stream"],
}


def classify_objection(text: str) -> Optional[str]:
    text_lower = text.lower()
    for objection, keywords in OBJECTION_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return objection
    return "unknown"
