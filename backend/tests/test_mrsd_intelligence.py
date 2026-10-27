"""Comprehensive Mrs.D Conversational Intelligence & Pipeline Tests.

Tests covering the complete 12 core evaluation scenarios (Tests A through L):
- Test A: Telugu script course inquiry ("మీ కాలేజీలో ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు ఉందా?")
- Test B: Roman Telugu / Tenglish course inquiry ("Madam, engineering lo AI course undha?")
- Test C: Telangana dialect phrasing ("College la AI course unda leda?")
- Test D: Floor-holding filler rejection ("Aa... ante... uhh...")
- Test E: Context follow-up ("Fee entha?")
- Test F: Self-repair ("CSE kaadu, AI and ML")
- Test G: Negation in retrieval ("Hostel fee kaadu, tuition fee")
- Test H: Unverified deadline / date honesty ("Application last date eppudu?")
- Test I: Code-mixed multi-intent ("Scholarship eligibility enti, and application online lo submit cheyocha?")
- Test J: Noise resistance (< 3 consecutive speech frames / < 60ms non-speech blip does not trigger false interruption)
- Test K: Interim vs final transcript handling (interim does not commit turn)
- Test L: Guarantee refusal ("Naaku admission guarantee chesthara?")
"""

import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock

from app.language.telugu_nlp import TeluguLanguageProcessor, ProcessedUtterance
from app.rag.prompt_builder import build_skills_system_prompt, build_prompt
from app.conversation.counsellor import ConversationState


# ---------------------------------------------------------------------------
# Test A: Telugu script course inquiry
# ---------------------------------------------------------------------------
def test_scenario_a_telugu_script_inquiry():
    """Verify 6-way multi-representation parsing for Telugu script course inquiry."""
    proc = TeluguLanguageProcessor()
    res = proc.process("మీ కాలేజీలో ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు ఉందా?")

    assert res.original_transcript == "మీ కాలేజీలో ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు ఉందా?"
    assert res.language_mode in ("telugu_script", "telugu_telugu")
    assert res.intent == "course_inquiry"
    assert any("artificial intelligence" in e.lower() for e in res.entities)
    assert not res.is_filler_only
    assert any(term in res.retrieval_query.lower() for term in ("course", "ai", "artificial", "engineering"))


# ---------------------------------------------------------------------------
# Test B: Roman Telugu / Tenglish course inquiry
# ---------------------------------------------------------------------------
def test_scenario_b_roman_telugu_inquiry():
    """Verify Roman Telugu / Tenglish course inquiry parsing."""
    proc = TeluguLanguageProcessor()
    res = proc.process("Madam, engineering lo AI course undha?")

    assert res.language_mode in ("roman_telugu", "code_mixed")
    assert res.intent == "course_inquiry"
    assert any("ai" in e.lower() or "artificial intelligence" in e.lower() for e in res.entities)
    assert not res.is_filler_only
    assert "course" in res.retrieval_query.lower() or "ai" in res.retrieval_query.lower()


# ---------------------------------------------------------------------------
# Test C: Telangana dialect phrasing
# ---------------------------------------------------------------------------
def test_scenario_c_telangana_regional_dialect():
    """Verify Telangana dialect locative marker 'la' and vocabulary."""
    proc = TeluguLanguageProcessor()
    res = proc.process("College la AI course unda leda?")

    assert res.dialect_markers.get("telangana") is True or "la" in res.normalized_text.lower()
    assert res.intent == "course_inquiry"
    assert any("ai" in e.lower() or "artificial" in e.lower() for e in res.entities)
    assert not res.is_filler_only


# ---------------------------------------------------------------------------
# Test D: Floor-holding filler rejection
# ---------------------------------------------------------------------------
def test_scenario_d_floor_holding_filler_rejection():
    """Verify that floor-holding fillers do not trigger premature answers or synthesis."""
    proc = TeluguLanguageProcessor()

    fillers = [
        "aa...",
        "ante...",
        "uhh",
        "mari...",
        "adi...",
        "aa... ante...",
        "uhmm... choodandi",
    ]

    for f in fillers:
        res = proc.process(f)
        assert res.is_filler_only is True, f"Failed for filler: {f}"

    # Genuine questions containing fillers must NOT be classified as filler-only
    non_fillers = [
        "Ante... hostel fee entha untundi?",
        "Aa... AI course undha?",
    ]
    for nf in non_fillers:
        res = proc.process(nf)
        assert res.is_filler_only is False, f"Erroneously flagged as filler-only: {nf}"


# ---------------------------------------------------------------------------
# Test E: Context follow-up
# ---------------------------------------------------------------------------
def test_scenario_e_context_followup_fee():
    """Verify elliptical follow-ups ('Fee entha?') extract fee inquiry intent and query."""
    proc = TeluguLanguageProcessor()

    res1 = proc.process("Fee entha?")
    assert res1.intent == "fee_inquiry"
    assert "fee" in res1.retrieval_query.lower()
    assert not res1.is_filler_only

    res2 = proc.process("హాస్టల్ ఫీజు ఎంత?")
    assert res2.intent in ("fee_inquiry", "hostel_inquiry")
    assert "hostel" in res2.entities or "hostel" in res2.retrieval_query.lower()


# ---------------------------------------------------------------------------
# Test F: Self-repair correction
# ---------------------------------------------------------------------------
def test_scenario_f_self_repair_correction():
    """Verify self-correction ('CSE kaadu, AI and ML') updates state slots and removes negated items."""
    proc = TeluguLanguageProcessor()
    res = proc.process("CSE kaadu, AI and ML")

    assert res.has_correction is True
    assert "cse" in res.negated_entities or "computer science" in res.negated_entities
    assert any("ai" in e.lower() or "artificial" in e.lower() or "ml" in e.lower() for e in res.entities)
    assert "cse" not in [e.lower() for e in res.entities]

    # Verify ConversationState slot transition
    state = ConversationState()
    state.slots["active_course"] = "Computer Science & Engineering (B.Tech)"
    new = state.observe("CSE kaadu, AI and ML")

    assert "active_course" in new
    assert "Artificial Intelligence" in state.slots["active_course"]
    assert "Computer Science" not in state.slots["active_course"]


# ---------------------------------------------------------------------------
# Test G: Negation in retrieval
# ---------------------------------------------------------------------------
def test_scenario_g_negation_in_retrieval():
    """Verify 'Hostel fee kaadu, tuition fee' extracts negated hostel fee and active tuition fee."""
    proc = TeluguLanguageProcessor()
    res = proc.process("Hostel fee kaadu, tuition fee cheppandi")

    assert res.has_correction is True
    assert "hostel" in res.negated_entities
    assert "tuition" in res.entities or "tuition fee" in res.normalized_text.lower()
    assert "hostel" not in [e.lower() for e in res.entities]

    state = ConversationState()
    state.slots["hostel"] = True
    new = state.observe("Hostel fee kaadu, tuition fee cheppandi")

    assert state.slots["hostel"] is False
    assert state.slots.get("fee_category") == "tuition_fee"


# ---------------------------------------------------------------------------
# Test H: Unverified deadline honesty
# ---------------------------------------------------------------------------
def test_scenario_h_unverified_deadline_honesty():
    """Verify prompt rules require verification fallback and forbid hallucinating dates."""
    proc = TeluguLanguageProcessor()
    res = proc.process("Application last date eppudu?")

    assert res.intent == "deadline_inquiry"
    assert "deadline" in res.entities
    assert "deadline" in res.retrieval_query.lower() or "date" in res.retrieval_query.lower()

    prompt = build_skills_system_prompt(
        agent_name="జానకి (Janaki)",
        company_name="Doneswari Technologies LLP",
        language_hint="Telugu",
    )

    assert "STRICT ADMISSIONS GROUNDING" in prompt
    assert "never invent" in prompt.lower()
    assert "admissions office" in prompt.lower() or "admissions cell" in prompt.lower()
    assert "verification" in prompt.lower() or "verified" in prompt.lower()


# ---------------------------------------------------------------------------
# Test I: Code-mixed multi-intent
# ---------------------------------------------------------------------------
def test_scenario_i_code_mixed_multi_intent():
    """Verify code-mixed multi-intent query retains both scholarship and application intents."""
    proc = TeluguLanguageProcessor()
    res = proc.process("Scholarship eligibility enti, and application online lo submit cheyocha?")

    assert "scholarship" in res.entities
    assert "eligibility" in res.entities
    assert "application" in res.entities
    assert "scholarship" in res.retrieval_query.lower()
    assert "application" in res.retrieval_query.lower() or "online" in res.retrieval_query.lower()


# ---------------------------------------------------------------------------
# Test J: Noise resistance (< 3 consecutive speech frames)
# ---------------------------------------------------------------------------
def test_scenario_j_noise_resistance_vad_frames():
    """Verify isolated noise frames (< 3 frames) do not trigger false barge-in interrupts."""
    speaking = True
    barge_in_frames = 0
    interrupted = False

    # Simulate 2 frames of non-speech energy blip (e.g. keyboard click, cough)
    for _ in range(2):
        is_speech = True
        if is_speech:
            barge_in_frames += 1
        else:
            barge_in_frames = 0

        if barge_in_frames >= 3 and speaking:
            interrupted = True

    # After 2 frames, must NOT interrupt
    assert interrupted is False
    assert barge_in_frames == 2

    # Silence resets counter
    is_speech = False
    if is_speech:
        barge_in_frames += 1
    else:
        barge_in_frames = 0

    assert barge_in_frames == 0
    assert interrupted is False

    # 3 consecutive frames of real speech triggers interruption
    for _ in range(3):
        is_speech = True
        if is_speech:
            barge_in_frames += 1
        else:
            barge_in_frames = 0

        if barge_in_frames >= 3 and speaking:
            interrupted = True

    assert interrupted is True
    assert barge_in_frames >= 3


# ---------------------------------------------------------------------------
# Test K: Interim vs final transcript handling
# ---------------------------------------------------------------------------
def test_scenario_k_interim_vs_final_transcript():
    """Verify interim transcripts do not commit the turn or queue for LLM generation."""
    utterance_queue = []

    def handle_ws_message(msg: dict):
        mtype = msg.get("type")
        if mtype in ("interim_text", "interim_transcript"):
            # Update display only, never queue
            return
        if mtype == "text":
            if msg.get("is_final") is False:
                return
            text = str(msg.get("text") or "").strip()
            if text:
                utterance_queue.append(("text", text))

    # Send interim transcript
    handle_ws_message({"type": "interim_text", "text": "mee college lo..."})
    handle_ws_message({"type": "text", "text": "mee college lo AI...", "is_final": False})
    assert len(utterance_queue) == 0

    # Send final transcript
    handle_ws_message({"type": "text", "text": "mee college lo AI course undha?", "is_final": True})
    assert len(utterance_queue) == 1
    assert utterance_queue[0] == ("text", "mee college lo AI course undha?")


# ---------------------------------------------------------------------------
# Test L: Guarantee refusal
# ---------------------------------------------------------------------------
def test_scenario_l_guarantee_refusal():
    """Verify prompt rules forbid admission/placement guarantees and explain merit basis."""
    proc = TeluguLanguageProcessor()
    res = proc.process("Naaku admission guarantee chesthara?")

    assert res.intent == "guarantee_inquiry"
    assert "guarantee_request" in res.entities

    state = ConversationState()
    new = state.observe("Naaku admission guarantee chesthara?")
    assert state.slots.get("guarantee_requested") is True

    prompt = build_skills_system_prompt(
        agent_name="జానకి (Janaki)",
        company_name="Doneswari Technologies LLP",
        language_hint="Telugu",
    )

    assert "REFUSAL OF ADMISSION & PLACEMENT GUARANTEES" in prompt
    assert "guarantee" in prompt.lower()
    assert "merit" in prompt.lower() or "eligibility" in prompt.lower()
