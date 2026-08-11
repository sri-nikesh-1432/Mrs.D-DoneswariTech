"""
Roman Telugu & Speech Normalization Module
==========================================
The single source of truth for:
  1. Roman Telugu detection  - "idhi enti", "meeru ekkada unnaru", etc.
  2. Roman Telugu -> Telugu internal transliteration (for LLM understanding)
  3. Telugu number-to-words  - fees (560, 1000, 100000, 125000, 249500) and years
  4. Speech cleanup          - money -> ""ఒక లక్ష రూపాయలు"", phone -> spaced digits,
                               abbreviations -> proper pronunciation (ఎం పి సి, నీట్, ...)

This module is dependency-free (pure Python) so both the Mrs. D pipeline
(backend/app) and the legacy pipeline (backend/services) can import it.
"""

import re

# ── 1. ROMAN TELUGU DETECTION ────────────────────────────────────────────
# Two word sets. "STRONG" words are unambiguous Roman-Telugu words that never
# appear in plain English (idhi, enti, meeru, kavali...). "WEAK" words are
# shared between Telugu and English (fee, college, hostel, bus...), so they
# must NEVER trigger a Telugu verdict on their own — otherwise plain English
# queries like "What are the fees?" get misclassified as Telugu.
_ROMAN_TELUGU_STRONG = {
    # pronouns / common words
    "idhi", "idi", "adi", "aadi", "ivi", "avvi",
    "mee", "maa", "naku", "naaku", "naa", "nee", "nuvvu", "meeru",
    "vaaru", "aanu", "unu", "andi", "amma", "anna",

    # question words
    "enti", "eppudu", "eppati", "ekkada", "ekkadiki", "enduku", "ela",
    "entha", "enthala", "evaru", "evariki", "yepudu", "yeppudu",
    "etla", "entaku", "evaranna",

    # common verbs
    "undi", "undhi", "unna", "unnaru", "unnar", "unnay", "unnayi", "unnaya",
    "unda", "undaa", "undha", "undhi", "vundi", "vundhi", "untadi", "untunda",

    # "I want to know about..." patterns
    "gurinchi", "gurinche", "telsukovalani", "telsukovalo", "telsukovali",
    "telskovali", "telskovalanu", "telskovalo", "telskovalani", "teluskovali",
    "kavali", "kaavali", "kavalo", "kavala", "kaavala",
    "cheppandi", "cheppu", "cheppara", "cheppagalaru", "cheppagalara",
    "isthara", "isthunnaru", "isthannaru",
    "avutundi", "avuthundi", "avthundi", "avthadi", "avutadi",
    "padutundi", "paduthundi", "pedutaru", "chestharu",
    "telsa", "telusa", "telsaa", "telisinda", "teliyali", "telustunda",
    "raavali", "ravvali", "ravali", "tarandi", "raandi", "randi",
    "eltunnaru", "raavoccha", "raavacha", "rayaccha", "chesoccha",
    "undachu", "unndachu", "avvocha", "avvachu",

    # misc common Telugu
    "alage", "alaga", "alane", "ila", "ilaa", "appudu",
    "prathi", "anni", "annii", "okate", "konchem", "koncham",
    "chaala", "chala", "baagundi", "bagundi", "baguntunda",
    "manchi", "manchidhi", "miku", "mikku", "ilanti",
    "alaanti", "veedu", "vaadu", "vaallu", "vallu", "maree",
    "inkem", "inkemi", "vere", "veredhi", "antava", "ante", "antey",
    "maku", "maku", "clg", "clz", "clgg", "collag",
}

# Shared English/Telugu words: only count as supporting evidence alongside a
# STRONG match — a plain-English sentence containing one of these must never
# be called Telugu.
_ROMAN_TELUGU_WEAK = {
    "fee", "fees", "hostel", "transport", "bus", "campus",
    "college", "collee", "colleji", "admission", "admissions",
    "seat", "seats", "scholarship", "scholarships", "course", "courses",
    "branch", "branches", "stream", "streams", "btech", "inter",
    "clg", "clz", "documents", "papers",
}

# Prefix matching: many Telugu words share stems. Match if the token starts
# with one of these to catch inflected forms robustly. Prefixes are chosen to
# never collide with common English stems (e.g. "unn" was dropped because it
# matches "unnecessary"/"unnamed"; "ches" was dropped because it matches
# "chess").
_ROMAN_TELUGU_PREFIXES = {
    "undi", "unna", "entha", "enduk", "ekkad", "eppud",
    "meeru", "naku", "kavali", "kaava", "kaav", "chepp", "isth",
    "avutu", "avuth", "padutu", "chesth", "undach",
    "konc", "chaal", "bagun", "aipo", "avvali", "raava",
}


def looks_roman_telugu(text: str) -> bool:
    """
    Return True if the (Latin-script) text strongly appears to be Roman Telugu
    rather than plain English. Uses weighted word matching.

    This is deliberately conservative: we only claim Telugu when there is
    clear evidence, so plain English queries are unaffected.
    """
    if not text:
        return False

    tokens = re.findall(r"[a-z][a-z]'?[a-z]*", text.lower())

    score = 0
    strong_hits = 0
    for tok in tokens:
        tok = tok.strip(".'").lower()
        if not tok:
            continue
        if tok in _ROMAN_TELUGU_STRONG:
            score += 2
            strong_hits += 1
        elif tok in _ROMAN_TELUGU_WEAK:
            score += 1
        elif any(tok.startswith(p) for p in _ROMAN_TELUGU_PREFIXES):
            score += 1

    # A single unambiguous Roman-Telugu word is decisive ("idhi enti",
    # "meeru unnaru", code-mixed "Hostel fee entha?"). Words shared with
    # English (fee, college, hostel, bus...) can never trigger a Telugu
    # verdict on their own — only an unusual accumulation of weak evidence
    # (score >= 3 with no strong word) may, to still catch heavy code-mixing.
    return strong_hits >= 1 or score >= 3


def blend_language_detection(text: str) -> str:
    """
    Combine Unicode-script detection (real Telugu chars) with Roman Telugu.
    Returns ISO code: "te" if Roman Telugu is detected, else "" (caller then
    uses its own script detector). Kept generic so both pipelines can call it.
    """
    # If real Telugu script is present caller's own detector handles it.
    if re.search(r"[\u0C00-\u0C7F]", text):
        return "te"
    if looks_roman_telugu(text):
        return "te"
    return ""


# ── 2. TELUGU NUMBER-TO-WORDS ────────────────────────────────────────────
_TE_ONES = {
    0: "", 1: "ఒకటి", 2: "రెండు", 3: "మూడు", 4: "నాలుగు", 5: "ఐదు",
    6: "ఆరు", 7: "ఏడు", 8: "ఎనిమిది", 9: "తొమ్మిది",
}
_TE_TEENS = {
    10: "పది", 11: "పదకొండు", 12: "పన్నెండు", 13: "పదమూడు",
    14: "పద్నాలుగు", 15: "పదిహేను", 16: "పదహారు", 17: "పదిహేడు",
    18: "పద్దెనిమిది", 19: "పంతొమ్మిది",
}
_TE_TENS = {
    2: "ఇరవై", 3: "ముప్పై", 4: "నలభై", 5: "యాభై", 6: "అరవై",
    7: "డెబ్బై", 8: "ఎనభై", 9: "తొంభై",
}


def _te_two_digit(n: int) -> str:
    if n < 10:
        return _TE_ONES[n]
    if n < 20:
        return _TE_TEENS[n]
    tens = n // 10
    ones = n % 10
    return (_TE_TENS[tens] + (" " + _TE_ONES[ones] if ones else "")).strip()


def number_to_telugu_words(n: int) -> str:
    """
    Convert a non-negative integer to Telugu words using Indian numbering.
      n=1000    -> "వెయ్యి"
      n=100000  -> "ఒక లక్ష"
      n=125000  -> "ఒక లక్ష ఇరవై ఐదు వేల"
      n=249500  -> "రెండు లక్షల నలభై తొమ్మిది వేల ఐదు వందల"
    """
    n = int(n)
    if n == 0:
        return "సున్నా"

    # crore (కోటి)
    crore = n // 10000000
    rem = n % 10000000
    # lakh (లక్ష)
    lakh = rem // 100000
    rem = rem % 100000
    # thousand (వెయ్యి)
    thousand = rem // 1000
    rem = rem % 1000
    # hundred
    hundred = rem // 100
    rem = rem % 100

    parts = []

    if crore:
        if crore == 1:
            parts.append("ఒక కోటి")
        else:
            crore_words = number_to_telugu_words(crore)
            parts.append(crore_words + (" కోట్ల" if crore > 1 else " కోటి"))

    if lakh:
        if lakh == 1 and not crore:
            # Natural Telugu: 100000 -> "ఒక లక్ష", not "ఒకటి లక్ష"
            parts.append("ఒక లక్ష")
        else:
            lakh_words = _te_two_digit(lakh) if lakh < 100 else number_to_telugu_words(lakh)
            parts.append(lakh_words + (" లక్షల" if lakh > 1 else " లక్ష"))

    if thousand:
        if thousand == 1 and not crore and not lakh:
            # Natural Telugu: 1000 -> "వెయ్యి", not "ఒకటి వెయ్యి"
            parts.append("వెయ్యి")
        else:
            th_words = _te_two_digit(thousand) if thousand < 100 else number_to_telugu_words(thousand)
            parts.append(th_words + (" వేల" if thousand > 1 else " వెయ్యి"))

    if hundred:
        if hundred == 1:
            # Natural Telugu: 100 -> "వంద", 1100 context handled above
            parts.append("వంద")
        else:
            parts.append(_te_two_digit(hundred) + " వందల")

    if rem:
        parts.append(_te_two_digit(rem))

    return " ".join(parts)


# English number-to-words (for years and general English amounts)
_EN_ONES = {
    0: "Zero", 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
    6: "Six", 7: "Seven", 8: "Eight", 9: "Nine",
}
_EN_TEENS = {
    10: "Ten", 11: "Eleven", 12: "Twelve", 13: "Thirteen", 14: "Fourteen",
    15: "Fifteen", 16: "Sixteen", 17: "Seventeen", 18: "Eighteen", 19: "Nineteen",
}
_EN_TENS = {
    2: "Twenty", 3: "Thirty", 4: "Forty", 5: "Fifty", 6: "Sixty",
    7: "Seventy", 8: "Eighty", 9: "Ninety",
}


def _en_two_digit(n: int) -> str:
    if n < 10:
        return _EN_ONES[n]
    if n < 20:
        return _EN_TEENS[n]
    t, o = divmod(n, 10)
    return (_EN_TENS[t] + (" " + _EN_ONES[o] if o else "")).strip()


def number_to_english_words(n: int) -> str:
    """English words for a number (Indian grouping). 2026 -> 'Two Thousand Twenty Six'."""
    n = int(n)
    if n == 0:
        return "Zero"
    crore = n // 10000000
    rem = n % 10000000
    lakh = rem // 100000
    rem = rem % 100000
    thousand = rem // 1000
    rem = rem % 1000
    hundred = rem // 100
    rem = rem % 100

    parts = []
    if crore:
        parts.append(number_to_english_words(crore) + (" Crore" if crore > 1 else " Crore"))
    if lakh:
        parts.append(_en_two_digit(lakh) + (" Lakh" if lakh == 1 else " Lakh"))
    if thousand:
        parts.append(_en_two_digit(thousand) + (" Thousand" if thousand == 1 else " Thousand"))
    if hundred:
        parts.append(_en_two_digit(hundred) + (" Hundred" if hundred == 1 else " Hundred"))
    if rem:
        parts.append(_en_two_digit(rem))
    return " ".join(parts)


# ── 3. SPEECH CLEANUP ─────────────────────────────────────────────────────
_PHONE_RE = re.compile(r"\b[6-9]\d{9}\b")
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")  # 4-digit year
_MONEY_RE = re.compile(r"(?:₹|RS\.?|rs\.?|Rs\.?)?\s*([0-9][0-9,]*)\b", re.IGNORECASE)

# Abbreviations -> pronunciation map. We map to a pronunciation that Edge-TTS
# reads correctly: for letter abbreviations join the roman letters with spaces
# ("ఎం పి సి") so it reads each letter; for words use phonetic spelling.
_ABBREV_PRON = {
    "MPC": "ఎం పి సి",
    "BiPC": "బై పి సి",
    "BIPC": "బై పి సి",
    "JEE": "జే ఈ ఈ",
    "NEET": "నీట్",
    "EAPCET": "ఈ ఏ పీ సీ ఈ టీ",
    "BITSAT": "బిట్ సాట్",
    "Aadhaar": "ఆధార్",
    "Aadhar": "ఆధార్",
    "Narayana": "నారాయణ",
    "Narayana Group": "నారాయణ గ్రూప్",
    "Hyderabad": "హైదరాబాద్",
    "Jubilee": "జూబిలీ",
    "Jubilee Hills": "జూబిలీ హిల్స్",
    "MBA": "ఎం బీ ఏ",
    "B.Tech": "బీ టెక్",
    "BTech": "బీ టెక్",
    "IIT": "ఐ ఐ టీ",
    "nLearn": "ఎన్ లెర్న్",
    "NLearn": "ఎన్ లెర్న్",
    "Olympiad": "ఒలింపియాడ్",
    "Transport": "ట్రాన్స్‌పోర్ట్",
    "Hostel": "హాస్టల్",
    "Admissions": "అడ్మిషన్స్",
    "College": "కాలేజీ",
    "Campus": "క్యాంపస్",
    "Scholarship": "స్కాలర్‌షిప్",
    "Scholarships": "స్కాలర్‌షిప్స్",
}

# ordered key matching (longest first so "B.Tech" beats "B.")
_ABBREV_KEYS = sorted(_ABBREV_PRON.keys(), key=len, reverse=True)


def _normalize_abbreviations(text: str) -> str:
    """Replace course/institution abbreviations with their spoken form."""
    for key in _ABBREV_KEYS:
        # word-boundary-aware but tolerant of case (MPC, mpc, Mpc)
        pattern = re.compile(r"(?<!\w)" + re.escape(key) + r"(?!\w)", re.IGNORECASE)
        if pattern.search(text):
            text = pattern.sub(_ABBREV_PRON[key].strip(), text)
    return text


def _contains_telugu(text: str) -> bool:
    """True if the text contains real Telugu Unicode characters."""
    return bool(re.search(r"[\u0C00-\u0C7F]", text))


_TELUGU_SCRIPT_RE = re.compile(r"[\u0C00-\u0C7F]")


# ── 5. SENTENCE SPLITTER (for sentence-level TTS streaming) ────────────────
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+|(?<=[.!?])(?=[\u0C00-\u0C7F])")


def split_into_sentences(text: str) -> list:
    """
    Split text into complete sentences on sentence-ending punctuation.

    Each returned piece is a COMPLETE sentence (including its trailing
    punctuation), so the frontend can synthesize & play them one at a time
    without ever cutting a sentence in the middle.

    Abbreviations with internal dots (B.Tech, Mrs., e.g.) are protected by
    a placeholder swap before splitting.
    """
    if not text:
        return []

    # Protect abbreviations containing dots so "B.Tech" is not split at the dot.
    _PROTECT = [
        (r"\bB\.Tech\b", "B_TECH_TOK"),
        (r"\bM\.Tech\b", "M_TECH_TOK"),
        (r"\bM\.tech\b", "M_TECH_TOK"),
        (r"\bMrs\.", "MRS_TOK"),
        (r"\bMr\.", "MR_TOK"),
        (r"\bDr\.", "DR_TOK"),
        (r"\bSt\.", "ST_TOK"),
        (r"\be\.g\.", "EG_TOK"),
        (r"\bi\.e\.", "IE_TOK"),
        (r"\betc\.", "ETC_TOK"),
        (r"\bvs\.", "VS_TOK"),
    ]
    protected = text
    for pattern, token in _PROTECT:
        protected = re.sub(pattern, token, protected)

    parts = [p.strip() for p in _SENTENCE_END_RE.split(protected) if p and p.strip()]

    # Restore protected tokens.
    restore = {
        "B_TECH_TOK": "B.Tech", "M_TECH_TOK": "M.Tech", "MRS_TOK": "Mrs.",
        "MR_TOK": "Mr.", "DR_TOK": "Dr.", "ST_TOK": "St.",
        "EG_TOK": "e.g.", "IE_TOK": "i.e.", "ETC_TOK": "etc.",
        "VS_TOK": "vs.",
    }
    restored = []
    for part in parts:
        for token, original in restore.items():
            part = part.replace(token, original)
        restored.append(part.strip())
    return restored


def normalize_for_speech(text: str) -> str:
    """
    Normalize generated text before TTS so numbers and abbreviations are
    spoken naturally instead of digit-by-digit.

      "The fee is ₹100000" -> "The fee is .100000" handled below by money
      "Fees is 100000"     -> converted via money regex
      "8179880241"         -> "Eight One Seven Nine Eight Eight Zero Two Four One"
      "in 2026"            -> "in Two Thousand Twenty Six"
      "MPC seats"          -> "ఎం పి సి seats"

    Rules:
      - Money (₹ / rupees context): convert to Telugu words + " రూపాయలు"
      - Year (4-digit 19xx/20xx): convert to English words
      - Phone number (10-digit starting 6-9): read digit by digit (spaced)
      - Abbreviations: replace with pronunciation
    """
    if not text:
        return text

    # Detect the reply's dominant script from the ORIGINAL text. Doing this
    # before abbreviation expansion matters: _normalize_abbreviations injects
    # Telugu script for terms like "Admissions" -> "అడ్మిషన్స్", which would
    # otherwise flip an English reply onto Telugu number words.
    telugu_reply = _contains_telugu(text)

    out = text

    # 1) Abbreviations FIRST so their digits/letters are not re-parsed as numbers.
    out = _normalize_abbreviations(out)

    # 2) Phone numbers -> spaced digits (do before general number handling)
    #    Digit names follow the dominant script so a Telugu reply is read
    #    "ఎనిమిది ఒకటి ఏడు..." and an English reply "Eight One Seven...".
    if telugu_reply:
        def _phone_repl(m: re.Match):
            return " ".join(_TE_ONES[int(d)] for d in m.group(0))
    else:
        def _phone_repl(m: re.Match):
            return " ".join(_EN_ONES[int(d)] for d in m.group(0))
    out = _PHONE_RE.sub(_phone_repl, out)

    # 3) Years -> words in the reply's dominant script. 2026 in Telugu text
    #    becomes "రెండు వేల ఇరవై ఆరు" (never digit-by-digit), in English text
    #    "Two Thousand Twenty Six".
    def _year_repl(m: re.Match):
        if telugu_reply:
            return number_to_telugu_words(int(m.group(0)))
        return number_to_english_words(int(m.group(0)))
    out = _YEAR_RE.sub(_year_repl, out)

    # 4) Money amounts -> Telugu words + " రూపాయలు". Fees are spoken in
    #    Telugu currency words (ఒక లక్ష రూపాయలు) even inside an English reply
    #    because the TTS voice is a native Telugu female voice — this matches
    #    how an Indian counsellor speaks amounts. ₹/rs prefixes handled too.
    id_words = out.split()
    new_tokens = []
    for tok in id_words:
        stripped = tok.lstrip("₹rsRSoo ").replace(",", "")
        lower = tok.lower()
        is_rupee_token = "₹" in tok or lower.startswith("rs") or lower.startswith("inr")
        if stripped.isdigit() and (is_rupee_token or (len(stripped) >= 4)):
            amount = int(stripped)
            new_tokens.append(number_to_telugu_words(amount) + " రూపాయలు")
        else:
            new_tokens.append(tok)
    out = " ".join(new_tokens)

    # 5) Cleanup stray spaces
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


# ── 4. ROMAN -> TELUGU TRANSLITERATION (internal) ────────────────────────
# A pragmatic mapping that covers the highest-frequency Roman Telugu words so
# the LLM reliably understands intent. This conversion is internal only; the
# caller still writes back in proper Telugu script.
_ROMAN_TO_TELUGU = {
    "idhi": "ఇది", "idi": "ఇది", "adi": "అది", "aadi": "ఆది",
    "endi": "ఏంటి", "enti": "ఏంటి",
    "meeru": "మీరు", "naaku": "నాకు", "naku": "నాకు", "naa": "నా",
    "nee": "నీ", "nuvvu": "నువ్వు", "maa": "మా", "mee": "మీ", "maku": "మాకు",
    "ekkada": "ఎక్కడ", "ekkadiki": "ఎక్కడికి", "eppudu": "ఎప్పుడు",
    "eppati": "ఎప్పటి", "enduku": "ఎందుకు", "ela": "ఎలా",
    "etla": "ఎలా", "entha": "ఎంత", "entaku": "ఎంతకు",
    "undi": "ఉంది", "undhi": "ఉంది", "unna": "ఉన్నా", "unnaru": "ఉన్నారు",
    "unnay": "ఉన్నాయి", "unnayi": "ఉన్నాయి", "unndachu": "ఉండచ్చు",
    "undachu": "ఉండచ్చు",
    "kavali": "కావాలి", "kaavali": "కావాలి", "kaava": "కావాలా",
    "cheppandi": "చెప్పండి", "cheppu": "చెప్పు", "cheppara": "చెప్పారా",
    "isthara": "ఇస్తారా", "isthunnaru": "ఇస్తున్నారు",
    "avutundi": "అవుతుంది", "avuthundi": "అవుతుంది", "avthundi": "అవుతుంది",
    "avthadi": "అవుతుంది", "avutadi": "అవుతుంది",
    "chaala": "చాలా", "chala": "చాలా", "koncham": "కొంచెం",
    "konchem": "కొంచెం", "appudu": "అప్పుడు", "annaru": "అన్నారు",
    "ante": "అంటే", "antava": "అంతవా", "inkemi": "ఇంకేమి",
    "inkem": "ఇంకేమి", "manchi": "మంచి", "baagundi": "బాగుంది",
    "bagundi": "బాగుంది", "vegutundi": "వెళ్తుంది", "telsa": "తెలుసా",
    "telusa": "తెలుసా", "telisinda": "తెలిసిందా", "raavali": "రావాలి",
    "ravvali": "రావాలి", "ravali": "రావాలి", "raavocha": "రావచ్చా",
    "raavacha": "రావచ్చా", "chesoccha": "చేయొచ్చా",
    "chesthaaru": "చేస్తారు", "chestharu": "చేస్తారు",
    "paduthundi": "పడుతుంది", "padutundi": "పడుతుంది",
    "campus": "క్యాంపస్", "hostel": "హాస్టల్", "college": "కాలేజీ",
    "clg": "కాలేజీ", "clz": "కాలేజీ", "collag": "కాలేజీ", "colleji": "కాలేజీ",
    "undha": "ఉందా", "undaa": "ఉందా", "vundi": "ఉంది", "vundhi": "ఉంది",
    "gurinchi": "గురించి", "gurinche": "గురించి",
    "telsukovalani": "తెలుసుకోవాలని", "telsukovalo": "తెలుసుకోవాలో",
    "telsukovali": "తెలుసుకోవాలి", "telskovali": "తెలుసుకోవాలి",
    "telskovalanu": "తెలుసుకోవాలని", "telskovalo": "తెలుసుకోవాలో",
    "telskovalani": "తెలుసుకోవాలని", "teluskovali": "తెలుసుకోవాలి",
    "lo": "లో", "loni": "లోని", "adi": "అది",
    "endukante": "ఎందుకంటే", "anduko": "అందుకో", "alage": "అలాగే",
    "admission": "అడ్మిషన్", "admissions": "అడ్మిషన్స్",
    "available": "అందుబాటులో", "facility": "సౌకర్యం", "facilities": "సౌకర్యాలు",
}


def transliterate_roman_telugu(text: str) -> str:
    """
    Convert highly-common Roman Telugu words to Telugu script so the LLM sees
    the true language/intent. Words not in the map are left as-is (they may be
    English terms like "fee", "hostel", "MPC" that naturally co-occur).
    This is internal only and never shown to the caller.
    """
    if not text:
        return text
    tokens = text.split()
    converted = []
    for tok in tokens:
        lower = tok.lower().strip("?!.,;:")
        if lower in _ROMAN_TO_TELUGU:
            # preserve a trailing punctuation mark
            punct = tok[-1] if tok[-1] in "?!.,;:" else ""
            converted.append(_ROMAN_TO_TELUGU[lower] + punct)
        else:
            converted.append(tok)
    return " ".join(converted)

