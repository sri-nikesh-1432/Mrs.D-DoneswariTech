"""
Outbound counsellor conversation engine.

The agent is the CALLER: it opens the conversation, asks the questions and
drives the counselling flow forward. The student only has to answer. This
module owns everything about that behaviour which must be enforced in CODE
rather than hoped for in a prompt:

  * LANGUAGE LOCK — once the student asks for Telugu (or English, or any other
    supported language) the conversation stays in that language. The language
    of the retrieved knowledge NEVER decides the spoken language (a Telugu
    caller still gets Telugu answers from an English PDF).
  * CONVERSATION STATE — stage, collected facts (group, career interest,
    joining year, hostel, location, ...), questions already asked, objections,
    interest level, callback.
  * PROACTIVE DRIVING — the next relevant question is computed from the state,
    never repeated, and the turn is allowed to end on it.
  * FOLLOW-UP ENFORCEMENT — a reply that answers the student but asks nothing
    is topped up with the next relevant question, so the agent never turns
    into a passive "anything else?" chatbot.
  * PASSIVE-PHRASE GUARD — "How can I help you?", "Anything else?", "Would you
    like to know more?" are stripped out before they are ever spoken.

Everything here is deterministic and unit-testable; the LLM only has to phrase
the turn naturally.
"""

import re
from typing import Dict, List, Optional

from app.roman_telugu import looks_roman_telugu  # noqa: F401  (re-exported use below)

# ── Language model ───────────────────────────────────────────────────────────

ENGLISH = "ENGLISH"
TELUGU = "TELUGU"
MIXED = "MIXED"

# Display name -> the three states the spec defines for reporting.
_CANONICAL = {
    "English": ENGLISH,
    "Telugu": TELUGU,
}

SUPPORTED_LANGUAGES = ("English", "Telugu", "Hindi", "Tamil", "Kannada", "Malayalam")

# Language-name spellings (Latin + native script) we recognise in a switch
# request such as "telugu lo maatladu" or "తెలుగులో మాట్లాడండి".
_LANGUAGE_NAMES: Dict[str, tuple] = {
    "Telugu": ("telugu", "telgu", "తెలుగు"),
    "English": ("english", "inglish", "ఇంగ్లీషు", "ఇంగ్లీష్"),
    "Hindi": ("hindi", "హిందీ", "हिंदी"),
    "Tamil": ("tamil", "తమిళ", "தமிழ்"),
    "Kannada": ("kannada", "కన్నడ", "ಕನ್ನಡ"),
    "Malayalam": ("malayalam", "మలయాళ", "മലയാളം"),
}

# Cues that mean "please switch/continue in <language>".
_SWITCH_CUE_RE = re.compile(
    r"\b(?:lo|in|speak|talk|reply|answer|say|continue|please|only|matladu|maatladu|"
    r"matladandi|matladu|mataladu|cheppu|cheppandi|chepu|chepandi|lo\s+matladu)\b"
    r"|మాట్లాడు|మాట్లాడండి|చెప్పు|చెప్పండి|లో|മാത്രം|ಮಾತನಾಡಿ|பேசு",
    re.IGNORECASE,
)


def detect_language_request(text: str) -> Optional[str]:
    """
    Return the language name the student is explicitly asking for, or None.

    Handles "talk in Telugu", "Telugu lo maatladu", "telugulo matladandi",
    "తెలుగులో మాట్లాడండి", "in English please", a bare "telugu", etc.
    """
    if not text or not text.strip():
        return None
    low = text.lower()
    words = text.split()

    for lang, spellings in _LANGUAGE_NAMES.items():
        if not any(sp in low for sp in spellings):
            continue
        # A bare language name ("telugu") is itself a request.
        if len(words) <= 3:
            return lang
        if _SWITCH_CUE_RE.search(text):
            return lang
    return None


# ── Passive / chatbot phrasing the agent must never use ─────────────────────

_PASSIVE_PHRASES = (
    "how can i help you",
    "how may i help you",
    "what can i do for you",
    "how can i assist you",
    "anything else",
    "any other question",
    "any other questions",
    "do you have any questions",
    "would you like to know more",
    "would you like to know anything else",
    "is there anything else",
    "let me know if you have any questions",
    "let me know if you need anything",
    "feel free to ask",
    "నేను మీకు ఏం సహాయం చేయగలను",
    "ఇంకా ఏమైనా కావాలా",
    "వేరే ఏమైనా ప్రశ్నలు ఉన్నాయా",
)

# Question markers: if a reply contains none of these, the agent answered
# without asking anything and the follow-up has to be supplied.
_QUESTION_MARKERS = (
    "?",
    "do you", "would you", "are you", "have you", "can you", "will you",
    "shall i", "should i", "what ", "which ", "when ", "where ", "how ",
    "who ", "is there", "are there", "any ", "or are you", "or will you",
)
_TE_QUESTION_MARKERS = (
    "ఏ", "ఎంత", "ఎప్పుడు", "ఎక్కడ", "ఎలా", "ఉందా", "ఉన్నాయా", "కావాలా",
    "చేయాలా", "అనుకుంటున్నారా", "ఇష్టమా", "చెప్పనా", "వస్తారా", "చేస్తారా",
    "కాదా", "ఉంది కదా", "సరేనా",
)


def response_has_question(text: str) -> bool:
    """True when the spoken reply asks the student something."""
    if not text or not text.strip():
        return False
    low = text.lower()
    if "?" in text:
        return True
    if any(m in low for m in _QUESTION_MARKERS):
        return True
    if any(m in text for m in _TE_QUESTION_MARKERS):
        return True
    # Telugu sentences often end with -ఆ/-ా questions without a "?".
    if re.search(r"[అ-హ][ా]\s*$", text.strip()):
        return True
    return False


def strip_passive_phrases(text: str) -> str:
    """
    Remove chatbot-style passive asks from a reply.

    A sentence containing one of the banned phrases is dropped (the next real
    counselling question is supplied by `ConversationState.next_question()`
    instead), and a trailing banned clause after a comma is cut off.
    """
    if not text or not text.strip():
        return ""
    sentences = re.split(r"(?<=[.!?।])\s+", text.strip())
    kept: List[str] = []
    for sentence in sentences:
        low = sentence.lower()
        if any(p in low for p in _PASSIVE_PHRASES):
            # Keep any real content that precedes the passive ask.
            for sep in (",", "—", " - "):
                if sep in low:
                    head = sentence.split(sep)[0].strip()
                    if head and not any(p in head.lower() for p in _PASSIVE_PHRASES):
                        kept.append(head + ".")
                    break
            continue
        kept.append(sentence.strip())
    return " ".join(k for k in kept if k).strip()


# ── Fact extraction ─────────────────────────────────────────────────────────

# Word-boundary regexes: plain substring checks would read "interested" as the
# course group "inter(mediate)" and "design" inside unrelated words.
_GROUP_RE = re.compile(
    r"\b(mpc|bipc|bi\s*pc|mec|cec|hec|polytechnic|diploma|iti|inter(?:mediate)?)\b",
    re.IGNORECASE,
)
_GROUP_LABELS = {
    "mpc": "MPC", "bipc": "BiPC", "bipc": "BiPC", "mec": "MEC", "cec": "CEC",
    "hec": "HEC", "polytechnic": "Polytechnic", "diploma": "Diploma", "iti": "ITI",
    "inter": "Intermediate", "intermediate": "Intermediate",
}
_CAREER_RE = re.compile(
    r"\b(engineering|engineer|jee|eamcet|eapcet|b\.?tech|medical|neet|mbbs|doctor|nursing|"
    r"commerce|chartered accountant|ca|law(?:yer)?|clat|civil services|upsc|defence|nda|"
    r"abroad|animation|design)\b",
    re.IGNORECASE,
)
_CAREER_LABELS = {
    "engineer": "engineering", "jee": "engineering", "eamcet": "engineering",
    "eapcet": "engineering", "btech": "engineering", "b.tech": "engineering",
    "neet": "medical", "mbbs": "medical", "doctor": "medical",
    "ca": "commerce", "chartered accountant": "commerce", "lawyer": "law",
    "clat": "law", "upsc": "civil services", "nda": "defence",
    "abroad": "study abroad",
}
_THIS_YEAR = ("this year", "this year itself", "now itself", "immediately",
              "ఈ ఏడాది", "ఈ సంవత్సరం", "ఈ యేడాది", "ee edade", "ee year")
_NEXT_YEAR = ("next year", "వచ్చే ఏడాది", "వచ్చే సంవత్సరం", "vachhe edadi",
              "next academic year")
_HOSTEL_YES = ("hostel", "hostal", "హాస్టల్", "వసతి", "హాస్టెల్")
_HOSTEL_NO = ("day scholar", "from home", "ఇంటి నుంచి", "intiki", "intti nunchi",
              "home nunchi", "తోటి", "not required", "అవసరం లేదు")
# A negation in the same sentence flips a mentioned facility to "not needed"
# ("hostel ledu" = no hostel — NOT "the student is not interested").
_NEGATIONS = ("ledu", "ledhu", "లేదు", "vaddu", "వద్దు", "voddu", "no need",
              "not needed", "don't need", "dont need", "not required", "no hostel")
_HOSTEL_POSITIVE = ("kavali", "kaavali", "కావాలి", "kaavala", "kavala", "yes",
                    "అవును", "అవసరం")
_TRANSPORT = ("bus", "బస్సు", "transport", "రవాణా", "vehicle", "van", "auto",
              "train", "కారు", "cab")
_PARENT = ("parent", "mother", "father", "mom", "dad", "అమ్మ", "నాన్న",
           "పేరెంట్", "guardian")
# NOTE: a bare Telugu negation ("ledu", "వద్దు") answers the LAST question —
# "hostel ledu" means "no hostel", not "not interested". Only an explicit
# statement about interest counts.
_NOT_INTERESTED_RE = re.compile(
    r"not\s+interested|no\s+interest|interest(?:ed)?\s*(?:ledu|ledhu)|ఆసక్తి\s*లేదు|"
    r"admission\s*(?:vaddu|వద్దు)|don'?t\s+want\s+admission|అడ్మిషన్\s*వద్దు",
    re.IGNORECASE,
)
_BUSY = ("busy", "బిజీ", "busy ga", "no time", "not a good time", "call later",
         "later call me")
_INTERESTED = ("interested", "ఆసక్తి ఉంది", "చేరాలనుకుంటున్న", "join avvali",
               "admission teeskovali", "చేయాలనుకుంటున్న")
_CALLBACK = ("call me later", "call back", "callback", "తర్వాత కాల్", "సాయంత్రం",
             "రేపు", "taruvata", "taruvatha", "evening", "tomorrow", "next week")
_OBJECTION = ("expensive", "costly", "too much", "ekkuva", "ekkuv", "kharchu",
              "ఖర్చు", "ఎక్కువ", "far", "dooram", "dhooram", "duram", "దూరం",
              "think about it", "ఆలోచించి", "compare", "not sure", "confused",
              "సందేహం", "parents tho", "అమ్మానాన్న")
# A place name, not an ALL-CAPS acronym ("from MPC" must not become a city).
_LOCATION_RE = re.compile(r"\bfrom\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)")
_LOCATION_TE_RE = re.compile(r"([ఀ-౿]{2,})\s*(?:నుంచి|నుండి)")
_LOCATION_ROMA_RE = re.compile(r"\b([A-Za-z]{3,})\s+(?:nunchi|nundi)\b")
_NAME_RE = re.compile(r"\bmy name is\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})?)", re.I)
_NAME_ROMA_RE = re.compile(r"\bna\s+peru\s+([A-Za-z]{2,})", re.I)


class ConversationState:
    """Per-call counselling state. Drives the conversation, not the prompt."""

    #: Ordered counselling flow: (slot key, stage, question wording per language)
    FLOW = (
        ("current_situation", "DISCOVERY", {
            "English": "Have you already decided on a course, or are you still exploring your options?",
            "Telugu": "మీరు ఏదైనా కోర్సు గురించి ఆలోచించారా, లేక ఇంకా చూస్తున్నారా?",
        }),
        ("course_group", "COURSE_DISCOVERY", {
            "English": "Which group are you thinking about — MPC, BiPC, or something else?",
            "Telugu": "మీరు ఏ గ్రూప్ గురించి ఆలోచిస్తున్నారు — MPC, BiPC, లేక ఇంకేదైనా?",
        }),
        ("career_interest", "INTEREST_DISCOVERY", {
            "English": "Are you mainly aiming for engineering after that, or are you still deciding?",
            "Telugu": "దాని తర్వాత ఇంజినీరింగ్ వైపు వెళ్లాలని అనుకుంటున్నారా, లేక ఇంకా నిర్ణయించుకోలేదా?",
        }),
        ("joining_year", "REQUIREMENT_DISCOVERY", {
            "English": "Are you planning to join this year?",
            "Telugu": "మీరు ఈ ఏడాదే జాయిన్ అవ్వాలని చూస్తున్నారా?",
        }),
        ("hostel", "REQUIREMENT_DISCOVERY", {
            "English": "And would you need hostel accommodation, or will you be travelling from home?",
            "Telugu": "మీకు హాస్టల్ కావాలా, లేక ఇంటి నుంచి వస్తారా?",
        }),
        ("location", "REQUIREMENT_DISCOVERY", {
            "English": "And roughly which area are you coming from?",
            "Telugu": "మీరు ఏ ప్రాంతం నుంచి వస్తున్నారు?",
        }),
        ("next_step", "ADMISSION_DISCUSSION", {
            "English": "Would you like to visit the campus, or shall I have a counsellor call you with the details?",
            "Telugu": "మీరు క్యాంపస్‌కి రావాలనుకుంటున్నారా, లేక మా కౌన్సిలర్ మీకు కాల్ చేసి వివరాలు చెప్పేలా ఏర్పాటు చేయనా?",
        }),
    )

    #: Gentle closings used when the student is not interested / busy.
    FOLLOW_UP_QUESTIONS = {
        "English": "Shall I arrange a short call back at a time that suits you?",
        "Telugu": "మీకు అనుకూలమైన సమయంలో మళ్లీ కాల్ చేయమని చెప్పనా?",
    }
    CLOSING_LINE = {
        "English": "Thank you for your time, and all the best!",
        "Telugu": "మీ సమయానికి ధన్యవాదాలు, ఆల్ ది బెస్ట్!",
    }

    def __init__(
        self,
        agent_name: str = "the counsellor",
        company_name: str = "the organization",
        language: Optional[str] = None,
    ):
        self.agent_name = agent_name
        self.company_name = company_name
        # Locked conversation language (display name). None until resolved.
        self.language: Optional[str] = language
        self.language_locked: bool = bool(language)
        self.slots: Dict[str, object] = {}
        self.asked: List[str] = []
        self.turn = 0
        self.student_turns = 0
        self.objections: List[str] = []
        self.not_interested = False
        self.busy = False
        self.callback_required = False
        self.interest_level = "Unclear"
        self.stage = "GREETING"
        self.student_asked_question = False

    # ── Language ────────────────────────────────────────────────────────────

    @property
    def conversation_language(self) -> str:
        """ENGLISH | TELUGU | MIXED — the spec's three-state view."""
        if not self.language:
            return MIXED
        return _CANONICAL.get(self.language, MIXED)

    def resolve_language(self, text: str, detected: Optional[str] = None) -> str:
        """
        Return the language the agent must SPEAK this turn.

        An explicit request always wins and locks. Otherwise the locked
        language is kept — the student's language never drifts just because a
        sentence came out in English, and the retrieved knowledge (usually an
        English PDF) never influences it.
        """
        requested = detect_language_request(text)
        if requested:
            if requested != self.language:
                self.language = requested
                self.language_locked = True
            return self.language

        if self.language:
            return self.language

        # First decisive signal of the call.
        if detected and detected in SUPPORTED_LANGUAGES:
            self.language = detected
        elif looks_roman_telugu(text or ""):
            self.language = "Telugu"
        else:
            self.language = "English"
        return self.language

    # ── Observation ─────────────────────────────────────────────────────────

    def observe(self, student_text: str, student_asked_question: bool = False) -> Dict:
        """
        Fold one student utterance into the state and return what was NEW.

        Extraction is pattern-based (Telugu script, Roman Telugu and English)
        so the next question never depends on the LLM remembering an answer.
        """
        text = student_text or ""
        low = text.lower()
        new: Dict[str, object] = {}
        self.turn += 1
        self.student_turns += 1
        self.student_asked_question = student_asked_question

        group_match = _GROUP_RE.search(text)
        if group_match:
            raw = re.sub(r"\s+", "", group_match.group(1).lower())
            group = _GROUP_LABELS.get(raw) or _GROUP_LABELS.get(group_match.group(1).lower())
            new["course_group"] = group
            self.slots["course_group"] = group
            self.slots.setdefault("current_situation", "decided")

        career_match = _CAREER_RE.search(text)
        if career_match:
            raw = career_match.group(1).lower()
            career = _CAREER_LABELS.get(raw, raw)
            new["career_interest"] = career
            self.slots["career_interest"] = career

        if any(k in low or k in text for k in _THIS_YEAR):
            new["joining_year"] = "this_year"
            self.slots["joining_year"] = "this_year"
        elif any(k in low or k in text for k in _NEXT_YEAR):
            new["joining_year"] = "next_year"
            self.slots["joining_year"] = "next_year"
        else:
            year = re.search(r"\b(20\d{2})\b", text)
            if year:
                new["joining_year"] = year.group(1)
                self.slots["joining_year"] = year.group(1)

        if any(k in low for k in _HOSTEL_NO):
            new["hostel"] = False
            self.slots["hostel"] = False
        elif any(k in low or k in text for k in _HOSTEL_YES):
            # "hostel kavali" is a clear yes; "hostel ledu" is a clear no; a
            # bare mention counts as yes only when nothing negates it.
            explicit_yes = any(k in low or k in text for k in _HOSTEL_POSITIVE)
            negated = any(k in low or k in text for k in _NEGATIONS)
            value = True if explicit_yes or not negated else False
            new["hostel"] = value
            self.slots["hostel"] = value

        if any(k in low or k in text for k in _TRANSPORT):
            self.slots["transport_required"] = True

        location = (
            _LOCATION_RE.search(text)
            or _LOCATION_TE_RE.search(text)
            or _LOCATION_ROMA_RE.search(text)
        )
        if location:
            value = location.group(1).strip()
            # Anchor the raw city name to the original casing when possible.
            if value and value in text:
                idx = text.find(value)
                value = text[idx:idx + len(value)]
            new["location"] = value
            self.slots["location"] = value

        name = _NAME_RE.search(text) or _NAME_ROMA_RE.search(text)
        if name:
            new["student_name"] = name.group(1).strip().title()
            self.slots["student_name"] = new["student_name"]

        if any(k in low or k in text for k in _PARENT):
            self.slots["caller_role"] = "parent"

        if _NOT_INTERESTED_RE.search(text):
            self.not_interested = True
            self.interest_level = "Not Interested"
        elif any(k in low or k in text for k in _INTERESTED):
            self.interest_level = "Interested"
        if any(k in low or k in text for k in _BUSY):
            self.busy = True
        if any(k in low or k in text for k in _CALLBACK):
            self.callback_required = True

        objection = next((k for k in _OBJECTION if k in low or k in text), None)
        if objection and objection not in self.objections:
            self.objections.append(objection)

        self.stage = self.current_stage()
        return new

    # ── Flow / questions ────────────────────────────────────────────────────

    def current_stage(self) -> str:
        """The stage the conversation is actually in right now."""
        if self.stage == "CLOSING":
            return "CLOSING"
        if self.student_asked_question:
            return "INFORMATION_REQUEST"
        if self.objections and not self.slots.get("career_interest"):
            return "OBJECTION_HANDLING"
        if self.not_interested or self.busy:
            return "FOLLOW_UP"
        for key, stage, _ in self.FLOW:
            if key not in self.asked and self.slots.get(key) is None:
                return stage
        return "ADMISSION_DISCUSSION"

    def next_question(self) -> Optional[str]:
        """
        The next question the agent should ask, or None when the flow is done.

        Never repeats a question whose answer is already known or which was
        already asked, and always speaks the LOCKED language.
        """
        language = self.language or "English"

        if self.stage == "CLOSING":
            return None

        if self.not_interested or self.busy or self.callback_required:
            key = "follow_up"
            if key not in self.asked:
                return self.FOLLOW_UP_QUESTIONS.get(language) or self.FOLLOW_UP_QUESTIONS["English"]
            return None

        for key, _stage, wording in self.FLOW:
            if key in self.asked:
                continue
            if self.slots.get(key) is not None:
                continue
            text = wording.get(language) or wording.get("English")
            if text:
                return text
        return None

    def mark_asked(self, key: str) -> None:
        if key and key not in self.asked:
            self.asked.append(key)

    def _flow_key_for(self, question_text: str) -> Optional[str]:
        for key, _stage, wording in self.FLOW:
            for text in wording.values():
                if text and text.split("?")[0][:40] in question_text:
                    return key
        if any(question_text in q or q[:30] in question_text for q in self.FOLLOW_UP_QUESTIONS.values()):
            return "follow_up"
        return None

    def mark_question_asked(self, question_text: str) -> None:
        """Record a question by its wording so it is not asked twice."""
        key = self._flow_key_for(question_text or "")
        if key:
            self.mark_asked(key)

    def note_agent_question(self, spoken: str) -> None:
        """
        Record that the agent asked something this turn.

        The LLM usually paraphrases our wording, so when the question cannot be
        matched to a specific flow step we still advance that step — otherwise
        the same question would be asked again on the next turn.
        """
        key = self._flow_key_for(spoken or "")
        if key:
            self.mark_asked(key)
            return
        for key, _stage, _wording in self.FLOW:
            if key not in self.asked and self.slots.get(key) is None:
                self.mark_asked(key)
                return

    def begin_closing(self) -> str:
        self.stage = "CLOSING"
        return self.CLOSING_LINE.get(self.language or "English") or self.CLOSING_LINE["English"]

    # ── Prompt support ──────────────────────────────────────────────────────

    def prompt_block(self) -> str:
        """
        Runtime state injected into the LLM as a system message.

        This is what keeps the model on the counselling flow, in the locked
        language, without asking anything twice.
        """
        known = ", ".join(f"{k}={v}" for k, v in self.slots.items() if v not in (None, ""))
        asked = ", ".join(self.asked) or "none"
        upcoming = self.next_question() or "—"
        language = self.language or "English"
        objections = ", ".join(self.objections) or "none"

        return (
            "## CONVERSATION STATE (internal — never read this aloud)\n"
            f"You are the CALLER: {self.agent_name} from {self.company_name}. You started this call and you drive it. "
            "The student only has to answer you.\n"
            f"Stage: {self.stage}\n"
            f"LOCKED LANGUAGE: {language}. Speak ONLY {language} for the rest of this call. "
            "Never switch language on your own, and never switch just because the knowledge below is written in another language.\n"
            f"Already known (never ask about these again): {known or 'nothing yet'}\n"
            f"Questions already asked: {asked}\n"
            f"Objections raised: {objections}\n"
            f"NEXT QUESTION TO ASK: {upcoming}\n"
            "Turn shape: a short natural acknowledgement, then (only if it was asked) the answer, "
            "then exactly ONE question — normally the NEXT QUESTION above, or a better one if the student just changed topic. "
            "Never end your turn without asking a question unless the call is closing. "
            "Never say 'How can I help you?', 'Anything else?', 'Do you have any questions?' or 'Would you like to know more?' — "
            "you already know why you called."
        )

    # ── Serialisation ───────────────────────────────────────────────────────

    def snapshot(self) -> Dict:
        return {
            "language": self.language,
            "conversation_language": self.conversation_language,
            "language_locked": self.language_locked,
            "stage": self.stage,
            "slots": dict(self.slots),
            "questions_asked": list(self.asked),
            "questions_answered": self.student_turns,
            "objections": list(self.objections),
            "not_interested": self.not_interested,
            "busy": self.busy,
            "callback_required": self.callback_required,
            "student_interest_level": self.interest_level,
        }

    @classmethod
    def from_dict(cls, data: Optional[Dict], **kwargs) -> "ConversationState":
        state = cls(**kwargs)
        if not data:
            return state
        state.language = data.get("language")
        state.language_locked = bool(data.get("language_locked"))
        state.stage = data.get("stage") or "GREETING"
        state.slots = dict(data.get("slots") or {})
        state.asked = list(data.get("questions_asked") or [])
        state.student_turns = int(data.get("questions_answered") or 0)
        state.objections = list(data.get("objections") or [])
        state.not_interested = bool(data.get("not_interested"))
        state.busy = bool(data.get("busy"))
        state.callback_required = bool(data.get("callback_required"))
        state.interest_level = data.get("student_interest_level") or "Unclear"
        return state


# ── Greeting (outbound opener) ──────────────────────────────────────────────

GREETING_PERMISSION = {
    "English": "Hi, this is {agent_name} calling from {company_name}. Is this a good time for a quick conversation?",
    "Telugu": "నమస్కారం, నేను {company_name} నుంచి {agent_name} మాట్లాడుతున్నాను. ఇప్పుడు రెండు నిమిషాలు మాట్లాడొచ్చా?",
}


def outbound_greeting(agent_name: str, company_name: str, language: str = "English") -> str:
    """The CALLER's opener: introduce, then ask permission. Never 'how can I help you'."""
    template = GREETING_PERMISSION.get(language) or GREETING_PERMISSION["English"]
    return template.format(agent_name=agent_name, company_name=company_name)


def enforce_follow_up(state: "ConversationState", spoken: str) -> Optional[str]:
    """
    The runtime guard that keeps the agent driving the call.

    Returns the next question to speak when the reply answered but asked
    nothing — the single behaviour that turned this agent into a chatbot.
    """
    if not state or state.stage == "CLOSING":
        return None
    if response_has_question(spoken):
        state.note_agent_question(spoken)
        return None
    question = state.next_question()
    if question:
        state.note_agent_question(question)
    return question
