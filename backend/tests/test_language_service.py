"""
Tests for the multilingual language support:
- Script-based language detection (te/hi/ta/kn/ml/en)
- Language-matched TTS voice selection
- Language-matched greetings from the JSON retriever
"""

import sys
from pathlib import Path

# Make `backend` importable (tests run from the backend directory)
BACKEND_DIR = Path(__file__).parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.language_service import detect_language, get_voice_for_language


def test_detect_telugu():
    assert detect_language("అస్సలు ఫీజు ఎంత? మీకు ఎలా సహాయం చేయగలను?") == "te"


def test_detect_hindi():
    assert detect_language("यह कितने का है? बहुत अच्छा है") == "hi"


def test_detect_tamil():
    assert detect_language("இது எவ்வளவு? மிகவும் நல்லது") == "ta"


def test_detect_kannada():
    assert detect_language("ಇದು ಎಷ್ಟು? ಉತ್ತಮ ಆಯ್ಕೆ") == "kn"


def test_detect_malayalam():
    assert detect_language("ഇത് എത്രയാണ്? വളരെ നല്ലത്") == "ml"


def test_detect_english_when_no_regional_script():
    assert detect_language("how much is the fee today") == "en"


def test_detect_empty_text_defaults_to_english():
    assert detect_language("") == "en"


def test_voice_map_covers_all_six_languages():
    assert get_voice_for_language("en") == "en-IN-NeerjaNeural"
    assert get_voice_for_language("te") == "te-IN-ShrutiNeural"
    assert get_voice_for_language("hi") == "hi-IN-SwaraNeural"
    assert get_voice_for_language("ta") == "ta-IN-PallaviNeural"
    assert get_voice_for_language("kn") == "kn-IN-SapnaNeural"
    assert get_voice_for_language("ml") == "ml-IN-SobhanaNeural"


def test_unknown_language_falls_back_to_english_voice():
    assert get_voice_for_language("xx") == "en-IN-NeerjaNeural"


def test_json_greeting_matches_language():
    from app.rag.json_retriever import JSONRetriever

    retriever = JSONRetriever("institute.json")
    assert "Hi!" in retriever.get_greeting("English")
    # Telugu greeting contains Telugu script characters
    telugu_greeting = retriever.get_greeting("Telugu")
    assert any("\u0c00" <= ch <= "\u0c7f" for ch in telugu_greeting)


def test_json_greeting_accepts_iso_code_and_falls_back():
    from app.rag.json_retriever import JSONRetriever

    retriever = JSONRetriever("institute.json")
    # ISO codes are normalized to display names
    assert retriever.get_greeting("te") == retriever.get_greeting("Telugu")
    # Unknown languages fall back to the default English greeting
    assert "Hi!" in retriever.get_greeting("Klingon")
