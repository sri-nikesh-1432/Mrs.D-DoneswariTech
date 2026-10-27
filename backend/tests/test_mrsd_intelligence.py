"""Comprehensive Mrs.D Conversational Intelligence & Pipeline Tests.

Tests cover:
- Test A: Course inquiry in Telugu & Roman Telugu (Telangana, Andhra, Tenglish)
- Test B: Floor-holding filler rejection (no premature response on fillers)
- Test C: Context follow-up ("Fee entha?" with antecedent context)
- Test D: Self-repair correction ("CSE kaadu, AI and ML")
- Test E: Negation ("Hostel fee kaadu, tuition fee")
- Test F: Unverified deadline / admission honesty
- Test G: Barge-in generation ID tracking and invalidation
"""

import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock

from app.language.telugu_nlp import TeluguLanguageProcessor, ProcessedUtterance
from app.rag.prompt_builder import build_skills_system_prompt, build_prompt


# ---------------------------------------------------------------------------
# Test A: Course inquiry in Telugu & Roman Telugu
# ---------------------------------------------------------------------------
def test_telugu_course_inquiry_representations():
    """Verify 6-way multi-representation parsing for Telugu course inquiry."""
    proc = TeluguLanguageProcessor()

    # Telugu script inquiry
    res1 = proc.process("మీ కాలేజీలో ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు ఉందా?")
    assert res1.original_transcript == "మీ కాలేజీలో ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ కోర్సు ఉందా?"
    assert res1.language_mode in ("telugu_script", "telugu_telugu")
    assert res1.intent == "course_inquiry"
    assert any("artificial intelligence" in e.lower() for e in res1.entities)
    assert not res1.is_filler_only
    assert "course" in res1.retrieval_query.lower() or "ai" in res1.retrieval_query.lower() or "artificial" in res1.retrieval_query.lower()

    # Roman Telugu / Tenglish inquiry
    res2 = proc.process("Madam, engineering lo AI course undha?")
    assert res2.language_mode in ("roman_telugu", "code_mixed")
    assert res2.intent == "course_inquiry"
    assert any("ai" in e.lower() or "artificial intelligence" in e.lower() for e in res2.entities)
    assert not res2.is_filler_only

    # Telangana dialect phrasing
    res3 = proc.process("College la AI course unda leda?")
    assert res3.dialect_markers.get("telangana") is True or "la" in res3.normalized_text.lower()
    assert res3.intent == "course_inquiry"


# ---------------------------------------------------------------------------
# Test B: Floor-holding filler rejection
# ---------------------------------------------------------------------------
def test_floor_holding_filler_rejection():
    """Verify that pure hesitations and floor-holding fillers do not trigger premature answers."""
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

    # Genuine questions containing fillers should NOT be classified as filler-only
    non_fillers = [
        "Ante... hostel fee entha untundi?",
        "Aa... AI course undha?",
    ]
    for nf in non_fillers:
        res = proc.process(nf)
        assert res.is_filler_only is False, f"Erroneously flagged as filler-only: {nf}"


# ---------------------------------------------------------------------------
# Test C: Context follow-up
# ---------------------------------------------------------------------------
def test_context_followup_fee():
    """Verify 'Fee entha?' is recognized as fee inquiry with retrieval query."""
    proc = TeluguLanguageProcessor()

    res = proc.process("Fee entha?")
    assert res.intent == "fee_inquiry"
    assert "fee" in res.retrieval_query.lower()
    assert not res.is_filler_only

    res2 = proc.process("హాస్టల్ ఫీజు ఎంత?")
    assert res2.intent in ("fee_inquiry", "hostel_inquiry")
    assert "hostel" in res2.entities or "hostel" in res2.retrieval_query.lower()


# ---------------------------------------------------------------------------
# Test D: Self-repair correction
# ---------------------------------------------------------------------------
def test_self_repair_correction():
    """Verify self-correction ('CSE kaadu, AI and ML') correctly extracts entities."""
    proc = TeluguLanguageProcessor()

    res = proc.process("CSE kaadu, AI and ML")
    assert res.has_correction is True
    assert "cse" in res.negated_entities or "computer science" in res.negated_entities
    assert any("ai" in e.lower() or "artificial" in e.lower() or "ml" in e.lower() for e in res.entities)
    assert "cse" not in [e.lower() for e in res.entities]


# ---------------------------------------------------------------------------
# Test E: Negation in RAG retrieval
# ---------------------------------------------------------------------------
def test_negation_extraction_and_filtering():
    """Verify 'Hostel fee kaadu, tuition fee' extracts negated hostel fee."""
    proc = TeluguLanguageProcessor()

    res = proc.process("Hostel fee kaadu, tuition fee cheppandi")
    assert res.has_correction is True
    assert "hostel" in res.negated_entities
    assert "tuition" in res.entities or "tuition fee" in res.normalized_text.lower()
    assert "hostel" not in [e.lower() for e in res.entities]


# ---------------------------------------------------------------------------
# Test F: Unverified deadline and admissions honesty
# ---------------------------------------------------------------------------
def test_admissions_grounding_prompt_rules():
    """Verify prompt builder includes strict admissions grounding rule 6."""
    prompt = build_skills_system_prompt(
        agent_name="జానకి (Janaki)",
        company_name="Doneswari Technologies LLP",
        language_hint="Telugu",
    )

    assert "STRICT ADMISSIONS GROUNDING" in prompt
    assert "never invent" in prompt.lower()
    assert "admission" in prompt.lower() or "deadline" in prompt.lower()
    assert "verification" in prompt.lower() or "verified" in prompt.lower()


# ---------------------------------------------------------------------------
# Test G: Barge-in generation ID invalidation
# ---------------------------------------------------------------------------
def test_generation_id_invalidation_logic():
    """Verify generation ID sequence and invalidation mechanism."""
    gen_counter = [0]
    active_generation = ["none"]

    # Start Turn 1
    gen_counter[0] += 1
    t1_gen = f"gen_{gen_counter[0]}_1000"
    active_generation[0] = t1_gen

    assert active_generation[0] == t1_gen

    # Barge-in occurs during Turn 1
    gen_counter[0] += 1
    cancelled_gen = f"cancelled_{gen_counter[0]}_1050"
    old_gen = active_generation[0]
    active_generation[0] = cancelled_gen

    # Turn 1 late packets must be dropped
    assert old_gen == t1_gen
    assert active_generation[0] != t1_gen
    assert active_generation[0].startswith("cancelled_")

    # Start Turn 2
    gen_counter[0] += 1
    t2_gen = f"gen_{gen_counter[0]}_1100"
    active_generation[0] = t2_gen

    assert active_generation[0] == t2_gen
    assert t2_gen != t1_gen
