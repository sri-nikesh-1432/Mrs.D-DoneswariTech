"""
Language Detection Service
Detects language from text using Unicode script ranges.
Supports: English (en), Telugu (te), Hindi (hi), Tamil (ta), Kannada (kn), Malayalam (ml).
No external library needed — pure Python Unicode analysis.
"""

import re
from utils.logger import get_logger

logger = get_logger(__name__)

# Unicode ranges for each script
_TELUGU_RE     = re.compile(r"[\u0C00-\u0C7F]")
_HINDI_RE      = re.compile(r"[\u0900-\u097F]")
_TAMIL_RE      = re.compile(r"[\u0B80-\u0BFF]")
_KANNADA_RE    = re.compile(r"[\u0C80-\u0CFF]")
_MALAYALAM_RE  = re.compile(r"[\u0D00-\u0D7F]")


def detect_language(text: str) -> str:
    """
    Detect the primary language of the given text.
    Returns ISO 639-1 code: 'en', 'te', 'hi', 'ta', 'kn', or 'ml'.
    Defaults to 'en' if no regional script is detected.
    """
    if not text:
        return "en"

    te_count = len(_TELUGU_RE.findall(text))
    hi_count = len(_HINDI_RE.findall(text))
    ta_count = len(_TAMIL_RE.findall(text))
    kn_count = len(_KANNADA_RE.findall(text))
    ml_count = len(_MALAYALAM_RE.findall(text))

    total_regional = te_count + hi_count + ta_count + kn_count + ml_count

    # Need at least 2 regional chars to confidently detect language
    if total_regional < 2:
        return "en"

    scores = {"te": te_count, "hi": hi_count, "ta": ta_count, "kn": kn_count, "ml": ml_count}
    detected = max(scores, key=scores.get)
    logger.debug(
        "Language detected: %s (te=%d hi=%d ta=%d kn=%d ml=%d)",
        detected, te_count, hi_count, ta_count, kn_count, ml_count,
    )
    return detected


def get_voice_for_language(lang: str) -> str:
    """Return the Edge-TTS voice name for the given language code."""
    from utils.config import settings
    return settings.TTS_VOICE_MAP.get(lang, settings.TTS_VOICE_MAP["en"])
