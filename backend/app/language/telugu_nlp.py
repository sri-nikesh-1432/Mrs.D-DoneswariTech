"""
Telugu Speech Intelligence & Conversational NLP Engine
=====================================================
Specialized for admissions telecalling in Andhra Pradesh and Telangana.

Handles:
  1. Telugu Script & Roman Telugu / Tenglish understanding
  2. Multi-representation architecture:
     - original_transcript
     - display_transcript
     - normalized_text
     - retrieval_query
     - intent_and_entities
     - language_mode
  3. Regional dialect, slang & code-switching (Telangana & Andhra variations)
  4. Conservative filler & floor-holding detection (prevents hallucinating on "ante...", "umm...")
  5. Semantic negation & correction preservation ("hostel fee kaadu, tuition fee")
  6. Admissions entity recognition (courses, branches, fees, deadlines, scholarships)
  7. Spoken currency & numeral pronunciation formatting for TTS
"""

import re
import unicodedata
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass, field

from app.roman_telugu import (
    looks_roman_telugu,
    transliterate_roman_telugu,
    number_to_telugu_words,
    number_to_english_words,
    normalize_for_speech,
)


@dataclass
class ProcessedUtterance:
    """Multi-representation utterance object preserving original vs retrieval queries."""
    original_transcript: str
    display_transcript: str
    normalized_text: str
    retrieval_query: str
    detected_language: str
    language_mode: str  # "telugu_script", "roman_telugu", "english", "hindi", "tamil", "mixed"
    is_filler_only: bool = False
    is_hesitation: bool = False
    has_negation: bool = False
    has_correction: bool = False
    negated_entities: List[str] = field(default_factory=list)
    active_entities: List[str] = field(default_factory=list)
    intent: str = "general_inquiry"  # "course_inquiry", "fee_inquiry", "hostel_inquiry", "deadline_inquiry", "scholarship_inquiry", etc.
    uncertainty_detected: bool = False

    @property
    def entities(self) -> List[str]:
        return self.active_entities

    @property
    def dialect_markers(self) -> Dict[str, bool]:
        text_lower = self.original_transcript.lower()
        return {
            "telangana": any(w in text_lower for w in [" la ", "kada ", "leda ", "lekapothe ", "la?", "etla"]),
            "andhra": any(w in text_lower for w in [" lo ", "andandi ", "undi ", "ela "]),
        }


# ── 1. FILLERS & HESITATIONS ────────────────────────────────────────────────
# Conversational floor-holding tokens: when an utterance consists ONLY of these,
# the telecaller must continue listening instead of hallucinating an answer.
TELUGU_SCRIPT_FILLERS: Set[str] = {
    "అంటే", "ఆ", "మ్", "హ్మ్", "ఏమంటారంటే", "అది", "అదే",
    "కొంచెం", "ఒక్క నిమిషం", "ఒక్కనిమిషం", "చెప్తాను", "ఏమో",
    "అంటే మేడమ్", "అంటే మేడం", "అంటే సార్", "అదిగో", "మరి", "ఇంకా", "చూడండి",
}

ROMAN_TELUGU_FILLERS: Set[str] = {
    "ante", "aa", "aah", "umm", "uhmm", "um", "uhh", "uh", "hmm", "hm",
    "emantarante", "emantey", "adi", "ade", "adhey", "konchem", "koncham",
    "okka nimisham", "okkanimisham", "chepthanu", "cheptanu", "emo",
    "ante madam", "ante sir", "mari", "inka", "one minute", "wait",
    "actually", "so", "like", "basically", "i mean", "choodandi", "chudandi",
}

# Hesitation / uncertainty markers that modify sentence confidence
UNCERTAINTY_MARKERS: Set[str] = {
    "కావచ్చు", "అనుకుంటా", "బహుశా", "ఏమో",
    "anukunta", "anukuntunna", "emo", "maybe", "probably", "i think",
}

# ── 2. NEGATION & CORRECTION MARKERS ───────────────────────────────────────
NEGATION_SCRIPT_TOKENS: Set[str] = {
    "లేదు", "కాదు", "వద్దు", "లేదా", "కాకపోతే", "లేకుండా", "కాకుండా",
}

NEGATION_ROMAN_TOKENS: Set[str] = {
    "ledu", "ledhu", "kaadu", "kadu", "kaadhu", "vaddu", "vadhu",
    "kakapothe", "lekundaa", "lekunda", "kakundaa", "kakunda", "not", "no",
}

CORRECTION_PATTERNS = [
    # Roman Telugu
    r"(?:ledu\s+ledu|kaadu\s+kaadu|adi\s+kaadu|wait\s+wait|wait\s+madam)[\s,]+(.*)",
    r"(.*)\s+kaadu[\s,]+(.*)\s+(?:adugutunna|cheppandi|kavali)",
    r"(.*)\s+ledu[\s,]+(.*)\s+(?:adugutunna|cheppandi|kavali)",
    r"(.*)\s+not\s+(.*)",
    # Telugu Script
    r"(?:లేదు\s+లేదు|కాదు\s+కాదు|అది\s+కాదు)[\s,]+(.*)",
    r"(.*)\s+కాదు[\s,]+(.*)\s+(?:అడుగుతున్నా|చెప్పండి|కావాలి)",
    r"(.*)\s+లేదు[\s,]+(.*)\s+(?:అడుగుతున్నా|చెప్పండి|కావాలి)",
]

# ── 3. ADMISSIONS TERMINOLOGY & ENTITY ALIASES ─────────────────────────────
COURSE_ALIASES: Dict[str, str] = {
    "ai": "Artificial Intelligence",
    "ai and ml": "Artificial Intelligence and Machine Learning",
    "ai ml": "Artificial Intelligence and Machine Learning",
    "aiml": "Artificial Intelligence and Machine Learning",
    "ai course": "Artificial Intelligence and Machine Learning",
    "ఆర్టిఫిషియల్ ఇంటెలిజెన్స్": "Artificial Intelligence",
    "ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు": "Artificial Intelligence",
    "cse": "Computer Science and Engineering",
    "computer science": "Computer Science and Engineering",
    "కంప్యూటర్ సైన్స్": "Computer Science and Engineering",
    "btech": "B.Tech Engineering",
    "b.tech": "B.Tech Engineering",
    "engineering": "B.Tech Engineering",
    "ఇంజనీరింగ్": "B.Tech Engineering",
    "mpc": "Intermediate MPC (Maths, Physics, Chemistry)",
    "ఎంపీసీ": "Intermediate MPC (Maths, Physics, Chemistry)",
    "bipc": "Intermediate BiPC (Biology, Physics, Chemistry)",
    "బైపీసీ": "Intermediate BiPC (Biology, Physics, Chemistry)",
    "mec": "Intermediate MEC (Maths, Economics, Commerce)",
    "cec": "Intermediate CEC (Civics, Economics, Commerce)",
    "neet": "NEET Medical Coaching",
    "నీట్": "NEET Medical Coaching",
    "jee": "IIT-JEE Coaching",
    "iit": "IIT-JEE Coaching",
    "iit jee": "IIT-JEE Coaching",
    "eamcet": "EAPCET / EAMCET Coaching",
    "eapcet": "EAPCET / EAMCET Coaching",
}

CATEGORY_KEYWORDS: Dict[str, List[str]] = {
    "fee": ["fee", "fees", "tuition", "tuition fee", "kharchu", "fees entha", "fee entha", "ఫీజు", "ఫీజులు", "ట్యూషన్", "ఎంత అవుతుంది", "cost"],
    "hostel": ["hostel", "hostel facility", "room", "accommodation", "హాస్టల్", "హాస్టల్ ఫెసిలిటీ", "వసతి"],
    "admission": ["admission", "admissions", "seat", "seats", "process", "అడ్మిషన్", "సీట్లు", "చేరడం"],
    "deadline": ["last date", "deadline", "date eppudu", "eppudu lopala", "చివరి తేదీ", "లాస్ట్ డేట్", "ఎప్పుడు లోపల"],
    "scholarship": ["scholarship", "nsat", "concession", "discount", "స్కాలర్‌షిప్", "రాయితీ"],
    "campus": ["campus", "location", "address", "branch", "where", "ekkada", "క్యాంపస్", "ఎక్కడ", "చిరునామా"],
    "eligibility": ["eligibility", "eligible", "qualify", "qualification", "అర్హత", "ఎవరు అర్హులు"],
    "application": ["application", "apply", "form", "online", "submit", "దరఖాస్తు"],
    "guarantee": ["guarantee", "గ్యారెంటీ", "పక్కా సీటు", "confirm seat", "seat confirm", "guarantee chesthara"],
}

# Regional colloquial verb & question stems (Telangana & Andhra)
REGIONAL_VARIANTS: Dict[str, str] = {
    "undha": "ఉందా",
    "unda": "ఉందా",
    "untunda": "ఉంటుందా",
    "untundha": "ఉంటుందా",
    "untadi": "ఉంటుంది",
    "untadhi": "ఉంటుంది",
    "dorkutunda": "దొరుకుతుందా",
    "dhorukuthundha": "దొరుకుతుందా",
    "etla": "ఎలా",
    "etla undi": "ఎలా ఉంది",
    "ela untundi": "ఎలా ఉంటుంది",
    "kavaleti": "కావాలి",
    "isthara": "ఇస్తారా",
    "cheppara": "చెప్పండి",
    "chepthar": "చెప్తారా",
    "cheptara": "చెప్తారా",
    "kattala": "కట్టాలా",
    "pay cheyocha": "చెల్లించవచ్చా",
    "katocha": "కట్టవచ్చా",
}


class TeluguLanguageProcessor:
    """
    Intelligent language processor distinguishing:
    1. Language spoken vs script used
    2. Conversational filler vs actionable query
    3. Negated topics vs intended questions
    4. Regional dialect normalization
    """

    @staticmethod
    def detect_script_and_language(text: str) -> Tuple[str, str]:
        """
        Returns (detected_language, language_mode).
        Distinguishes Telugu in Telugu Script vs Roman Telugu / Tenglish.
        """
        if not text or not text.strip():
            return "English", "english"

        # Check for Telugu Unicode characters (U+0C00 to U+0C7F)
        has_telugu_script = bool(re.search(r"[\u0C00-\u0C7F]", text))
        has_hindi_script = bool(re.search(r"[\u0900-\u097F]", text))
        has_tamil_script = bool(re.search(r"[\u0B80-\u0BFF]", text))

        if has_telugu_script:
            return "Telugu", "telugu_script"
        if has_hindi_script:
            return "Hindi", "hindi"
        if has_tamil_script:
            return "Tamil", "tamil"

        # Check for Roman Telugu / Tenglish in Latin script
        if looks_roman_telugu(text):
            return "Telugu", "roman_telugu"

        return "English", "english"

    @classmethod
    def is_filler_or_hesitation(cls, text: str) -> Tuple[bool, bool]:
        """
        Determine if the user utterance is:
        - (is_filler_only, is_hesitation)
        e.g. "ante..." or "Umm... B.Tech..."
        """
        cleaned = re.sub(r"[.,!?…\-]", " ", text.strip().lower())
        tokens = [t.strip() for t in cleaned.split() if t.strip()]

        if not tokens:
            return True, False

        # Check if all tokens are purely filler tokens
        is_all_filler = all(
            (t in ROMAN_TELUGU_FILLERS or t in TELUGU_SCRIPT_FILLERS)
            for t in tokens
        )

        has_hesitation = any(
            t in UNCERTAINTY_MARKERS or t in ROMAN_TELUGU_FILLERS
            for t in tokens
        )

        # Incomplete sentence with trailing hesitation
        ends_with_hesitation = False
        if tokens:
            last = tokens[-1]
            if last in ("ante", "umm", "aa", "అంటే", "ఆ", "మ్"):
                ends_with_hesitation = True

        return is_all_filler, (has_hesitation or ends_with_hesitation)

    @classmethod
    def extract_negation_and_corrections(cls, text: str) -> Tuple[bool, List[str], str]:
        """
        Preserve semantic negation and self-corrections.
        e.g., "hostel fee kaadu, tuition fee cheppandi"
        Returns:
            (has_negation, negated_entities, target_query)
        """
        has_negation = False
        negated_entities: List[str] = []
        target_query = text

        lower = text.lower()

        # Check for presence of negation tokens
        for neg in NEGATION_ROMAN_TOKENS:
            pattern = rf"\b{re.escape(neg)}\b"
            if re.search(pattern, lower):
                has_negation = True
                break

        if not has_negation:
            for neg in NEGATION_SCRIPT_TOKENS:
                if neg in text:
                    has_negation = True
                    break

        if has_negation:
            # Check known entity pairs (e.g. hostel vs tuition / course fee)
            if "hostel" in lower and ("kaadu" in lower or "kadu" in lower or "not" in lower or "కాదు" in text or "లేదు" in text):
                negated_entities.append("hostel")
                # Clean target query
                target_query = re.sub(r"(?:hostel\s*fee|hostel)\s*(?:kaadu|kadu|not|కాదు|లేదు)[\s,]*", "", target_query, flags=re.IGNORECASE)

            if "cse" in lower and ("kaadu" in lower or "kadu" in lower or "not" in lower or "కాదు" in text or "లేదు" in text):
                negated_entities.append("cse")
                target_query = re.sub(r"(?:cse)\s*(?:kaadu|kadu|not|కాదు|లేదు)[\s,]*", "", target_query, flags=re.IGNORECASE)

        # Detect correction phrases like "ledu ledu, nenu X gurinchi adugutunna"
        correction_match = re.search(r"(?:ledu\s+ledu|kaadu\s+kaadu|లేదు\s+లేదు|కాదు\s+కాదు)[\s,]+(.*)", text, re.IGNORECASE)
        if correction_match:
            target_query = correction_match.group(1).strip()

        return has_negation, negated_entities, target_query.strip()

    @classmethod
    def build_normalized_retrieval_query(
        cls,
        text: str,
        negated_entities: List[str],
        detected_language: str,
    ) -> str:
        """
        Create a clean, conservative retrieval query for FAISS & BM25 search.
        Preserves courses, fees, deadlines, and distinguishes course fee from hostel fee.
        """
        # Conservative normalization: handle Unicode
        norm = unicodedata.normalize("NFKC", text).strip()

        # Transliterate Roman Telugu for intent understanding if in Roman script
        llm_searchable = transliterate_roman_telugu(norm) if looks_roman_telugu(norm) else norm

        # Expand common course abbreviations
        tokens = norm.lower().split()
        expanded_terms = []
        for t in tokens:
            cleaned_t = t.strip(".,?!:;()")
            if cleaned_t in COURSE_ALIASES:
                expanded_terms.append(COURSE_ALIASES[cleaned_t])
            else:
                expanded_terms.append(cleaned_t)

        query = " ".join(expanded_terms)

        # Clarify intent in query
        if "fee" in query.lower() or "fees" in query.lower() or "ఫీజు" in query:
            if "hostel" in negated_entities:
                query = f"academic tuition course fee structure (excluding hostel) {query}"
            elif "hostel" in query.lower():
                query = f"hostel accommodation fee room charges {query}"
            else:
                query = f"course tuition fee structure {query}"

        if "ai" in query.lower() or "artificial intelligence" in query.lower() or "ఆర్టిఫిషియల్ ఇంటెలిజెన్స్" in query:
            query = f"Artificial Intelligence B.Tech engineering course details {query}"

        if "last date" in query.lower() or "deadline" in query.lower() or "చివరి తేదీ" in query:
            query = f"admission deadline last date application schedule {query}"

        if "scholarship" in query.lower() or "nsat" in query.lower() or "స్కాలర్‌షిప్" in query:
            query = f"scholarship eligibility criteria NSAT fee concession {query}"

        if "online" in query.lower() or "apply" in query.lower() or "application" in query.lower() or "submit" in query.lower():
            query = f"admission online application process submission {query}"

        return query.strip()

    @classmethod
    def process_utterance(
        cls,
        raw_text: str,
        stt_hint_lang: Optional[str] = None,
    ) -> ProcessedUtterance:
        """
        Complete utterance processing pipeline returning structured ProcessedUtterance.
        """
        original = raw_text.strip()
        display = original

        # 1. Script & Language detection
        detected_lang, lang_mode = cls.detect_script_and_language(original)
        if stt_hint_lang and stt_hint_lang.lower() in ("te", "telugu") and lang_mode == "english":
            # STT heard Telugu, so treat as Roman Telugu/Tenglish
            detected_lang = "Telugu"
            lang_mode = "roman_telugu"

        # 2. Filler and hesitation checks
        is_filler_only, is_hesitation = cls.is_filler_or_hesitation(original)

        # 3. Negation & correction extraction
        has_negation, negated_entities, clean_target = cls.extract_negation_and_corrections(original)
        has_correction = bool(negated_entities or "ledu ledu" in original.lower() or "kaadu kaadu" in original.lower())

        # 4. Uncertainty check
        uncertainty_detected = any(u in original.lower() for u in UNCERTAINTY_MARKERS)

        # 5. Intent and entity extraction
        active_entities = []
        intent = "general_inquiry"
        lower_orig = original.lower()

        for cat, keywords in CATEGORY_KEYWORDS.items():
            if any(k in lower_orig or k in original for k in keywords):
                if cat == "fee":
                    intent = "fee_inquiry"
                    active_entities.append("fee")
                elif cat == "hostel":
                    if "hostel" not in negated_entities:
                        intent = "hostel_inquiry"
                        active_entities.append("hostel")
                elif cat == "deadline":
                    intent = "deadline_inquiry"
                    active_entities.append("deadline")
                elif cat == "scholarship":
                    intent = "scholarship_inquiry"
                    active_entities.append("scholarship")
                elif cat == "admission":
                    intent = "admission_inquiry"
                    active_entities.append("admission")
                elif cat == "eligibility":
                    if intent == "general_inquiry":
                        intent = "eligibility_inquiry"
                    active_entities.append("eligibility")
                elif cat == "application":
                    if intent == "general_inquiry":
                        intent = "application_inquiry"
                    active_entities.append("application")
                elif cat == "guarantee":
                    intent = "guarantee_inquiry"
                    active_entities.append("guarantee_request")

        for course, full_name in COURSE_ALIASES.items():
            pattern = rf"(?:\b|^){re.escape(course)}(?:\b|$)"
            if re.search(pattern, lower_orig) or course in lower_orig:
                if course in negated_entities or any(course in neg for neg in negated_entities):
                    continue
                if full_name not in active_entities:
                    active_entities.append(full_name)
                if intent == "general_inquiry":
                    intent = "course_inquiry"

        # 6. Normalized Text & Retrieval Query
        norm_text = unicodedata.normalize("NFKC", clean_target).strip()
        retrieval_query = cls.build_normalized_retrieval_query(clean_target, negated_entities, detected_lang)

        return ProcessedUtterance(
            original_transcript=original,
            display_transcript=display,
            normalized_text=norm_text,
            retrieval_query=retrieval_query,
            detected_language=detected_lang,
            language_mode=lang_mode,
            is_filler_only=is_filler_only,
            is_hesitation=is_hesitation,
            has_negation=has_negation,
            has_correction=has_correction,
            negated_entities=negated_entities,
            active_entities=active_entities,
            intent=intent,
            uncertainty_detected=uncertainty_detected,
        )

    # Convenience alias
    process = process_utterance
