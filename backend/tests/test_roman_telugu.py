"""
Tests for the Roman Telugu & speech-normalization module:
- Roman Telugu detection ("idhi enti" -> Telugu)
- Telugu number-to-words conversion for fees and years
- Speech cleanup for money, phone numbers, and abbreviations
"""

import sys
from pathlib import Path

# Make `backend` importable (tests run from the backend directory).
BACKEND_DIR = Path(__file__).parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:
    from app.roman_telugu import (
        looks_roman_telugu,
        number_to_telugu_words,
        number_to_english_words,
        normalize_for_speech,
        transliterate_roman_telugu,
    )
except ImportError:
    import app.roman_telugu as m
    looks_roman_telugu = m.looks_roman_telugu
    number_to_telugu_words = m.number_to_telugu_words
    number_to_english_words = m.number_to_english_words
    normalize_for_speech = m.normalize_for_speech
    transliterate_roman_telugu = m.transliterate_roman_telugu


# ── Roman Telugu detection ────────────────────────────────────────────────
def test_detects_simple_roman_telugu():
    assert looks_roman_telugu("idhi enti") is True
    assert looks_roman_telugu("meeru ekkada unnaru") is True


def test_detects_roman_telugu_questions():
    for q in [
        "idhi enti",
        "meeru ekkada unnaru",
        "hostel fee entha",
        "admission eppudu start avutundi",
        "naku MPC kavali",
        "bus facility unda",
        "meeru scholarship isthara",
    ]:
        assert looks_roman_telugu(q) is True, q


def test_code_mixed_is_telugu():
    assert looks_roman_telugu("Hostel fee entha?") is True
    assert looks_roman_telugu("MPC seats unnaya?") is True
    assert looks_roman_telugu("Admission process cheppandi") is True


def test_does_not_detect_plain_english():
    assert looks_roman_telugu("What are the fees?") is False
    assert looks_roman_telugu("how much is the fee today") is False
    assert looks_roman_telugu("Please tell me about the college") is False


def test_transliterate_roman_telugu():
    out = transliterate_roman_telugu("idhi enti")
    # At least the known words are converted to Telugu script.
    assert "ఇది" in out or "ఏంటి" in out


# ── Telugu number-to-words ────────────────────────────────────────────────
def test_number_to_telugu_words_small():
    assert number_to_telugu_words(1000) == "ఒకటి వెయ్యి" or "వెయ్యి" in number_to_telugu_words(1000)


def test_number_to_telugu_words_lakh():
    assert "లక్ష" in number_to_telugu_words(100000)


def test_number_to_telugu_words_125000():
    words = number_to_telugu_words(125000)
    assert "లక్ష" in words


def test_number_to_telugu_words_249500():
    words = number_to_telugu_words(249500)
    assert "లక్ష" in words
    assert "వేల" in words


def test_english_year():
    assert number_to_english_words(2026) == "Two Thousand Twenty Six"


# ── Speech normalization ──────────────────────────────────────────────────
def test_normalize_fees_to_words():
    assert "రూపాయలు" in normalize_for_speech("The fee is ₹100000")
    assert "లక్ష" in normalize_for_speech("Fee is 100000")


def test_normalize_phone_number_spaced():
    out = normalize_for_speech("Call me at 8179880241 please")
    # digits become words
    assert "Eight" in out


def test_normalize_year():
    out = normalize_for_speech("Admissions for 2026 are open")
    assert "Two Thousand Twenty Six" in out


def test_normalize_abbreviation_mpc():
    out = normalize_for_speech("MPC seats available")
    # MPC should not remain a bare Latin acronym
    assert "ఎం పి సి" in out or "MPC" not in out.upper()

