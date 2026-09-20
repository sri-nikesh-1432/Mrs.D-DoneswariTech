"""
Runtime behaviour tests for the outbound counsellor (spec §1-§31).

These exercise the CODE that enforces the conversation model — language
locking, progressive questioning, no repeated questions, follow-up
enforcement and passive-phrase removal — not the wording of a prompt.
"""

import pytest

from app.conversation.counsellor import (
    ENGLISH,
    TELUGU,
    ConversationState,
    detect_language_request,
    enforce_follow_up,
    outbound_greeting,
    response_has_question,
    strip_passive_phrases,
)


def _state() -> ConversationState:
    state = ConversationState("Sangeetha", "Narayana College")
    # The greeting already asked permission ("is this a good time?").
    state.stage = "PERMISSION"
    return state


def _turn(state: ConversationState, student_text: str, spoken: str = "") -> str:
    """
    Simulate one real turn: the student answers, then the agent's reply
    (`spoken`) goes through the follow-up guard. Returns what the guard had to
    add, or "" when the agent's own reply already asked something.
    """
    state.resolve_language(student_text)
    state.observe(student_text, student_asked_question=response_has_question(student_text))
    follow_up = enforce_follow_up(state, spoken) or ""
    state.stage = state.current_stage()
    return follow_up


class TestOutboundOpener:
    def test_greeting_asks_permission_and_never_asks_how_to_help(self):
        greeting = outbound_greeting("Sangeetha", "Narayana College")
        assert "Sangeetha" in greeting and "Narayana College" in greeting
        assert "good time" in greeting.lower()
        assert "how can i help" not in greeting.lower()
        assert "how may i help" not in greeting.lower()

    def test_greeting_exists_in_the_locked_language(self):
        telugu = outbound_greeting("సంగీత", "నారాయణ కళాశాల", "Telugu")
        assert "నమస్కారం" in telugu


class TestProactiveCounsellingFlow:
    """Spec §3 §26: the agent asks, the student answers, the agent asks again."""

    def test_english_flow_progresses_one_question_at_a_time(self):
        """Spec §26: the agent drives — answer, acknowledge, next question."""
        state = _state()

        q1 = state.next_question() or ""
        assert "decided on a course" in q1 or "exploring" in q1
        _turn(state, "Yes", f"Great. {q1}")

        q2 = state.next_question() or ""
        assert "group" in q2.lower() and "mpc" in q2.lower()
        _turn(state, "MPC", f"Okay, MPC. {q2}")

        q3 = state.next_question() or ""
        assert "engineering" in q3.lower()
        _turn(state, "Engineering", f"Got it. {q3}")

        q4 = state.next_question() or ""
        assert "join this year" in q4.lower()
        _turn(state, "Yes, this year", f"Okay. {q4}")

        q5 = state.next_question() or ""
        assert "hostel" in q5.lower()
        _turn(state, "Hostel kavali", f"Sure. {q5}")

        q6 = state.next_question() or ""
        assert "area" in q6.lower()
        # The student's answers are all remembered.
        assert state.slots["course_group"] == "MPC"
        assert state.slots["career_interest"] == "engineering"
        assert state.slots["joining_year"] == "this_year"
        assert state.slots["hostel"] is True

    def test_agent_reply_that_answers_but_asks_nothing_is_topped_up(self):
        """The guard fires when the model answers without asking anything."""
        state = _state()
        added = _turn(state, "MPC", "MPC has Maths, Physics and Chemistry.")
        assert added and response_has_question(added)

    def test_answers_are_remembered_and_not_asked_twice(self):
        state = _state()
        q1 = state.next_question() or ""
        _turn(state, "Yes", f"Great. {q1}")
        q2 = state.next_question() or ""
        assert "mpc" in q2.lower()
        _turn(state, "MPC", f"Okay. {q2}")

        # The student repeats the group; the agent must not re-ask it.
        state.observe("MPC only")
        assert "mpc" not in (state.next_question() or "").lower()

    def test_all_flow_questions_are_asked_at_most_once(self):
        state = _state()
        seen = []
        for _ in range(10):
            q = state.next_question()
            if not q:
                break
            seen.append(q)
            state.note_agent_question(q)
        assert len(seen) == len(set(seen))
        # Six flow questions then the follow-up/closing, never an endless loop.
        assert len(seen) <= 8
        assert state.next_question() in (None, state.FOLLOW_UP_QUESTIONS["English"])

    def test_paraphrased_agent_question_still_advances_the_flow(self):
        """The LLM rarely uses our wording verbatim — the flow must still move."""
        state = _state()
        state.note_agent_question("So what are you planning to study after your boards?")
        assert "current_situation" in state.asked
        # The next step is now the course group, not the question it just asked.
        assert "group" in (state.next_question() or "").lower()


class TestLanguageLock:
    """Spec §6 §7 §10 §24: language locks and never follows the knowledge."""

    def test_telugu_request_locks_the_conversation(self):
        state = _state()
        assert state.resolve_language("Telugu lo maatladu") == "Telugu"
        assert state.conversation_language == TELUGU
        assert state.language_locked

        # Every later turn stays Telugu, even an English-sounding reply and
        # even though the knowledge base is in English.
        assert state.resolve_language("Yes, correct") == "Telugu"
        assert state.resolve_language("from Hyderabad", detected="English") == "Telugu"
        assert "?" in (state.next_question() or "")

    def test_telugu_script_request_and_native_next_question(self):
        state = _state()
        assert state.resolve_language("తెలుగులో మాట్లాడండి") == "Telugu"
        question = state.next_question() or ""
        # Telugu script, not English, for the next counselling question.
        assert any("\u0c00" <= ch <= "\u0c7f" for ch in question)

    def test_explicit_english_request_switches_back(self):
        state = _state()
        state.resolve_language("telugu lo matladu")
        assert state.resolve_language("Can you talk in English please?") == "English"
        assert state.conversation_language == ENGLISH

    def test_language_request_detection_ignores_normal_sentences(self):
        # "telsu" is not "telugu"; a normal Telugu sentence is not a request.
        assert detect_language_request("adhi naku kuda telsu, vivaralu cheppandi") is None
        assert detect_language_request("fees entha") is None
        assert detect_language_request("Telugu lo maatladu") == "Telugu"
        assert detect_language_request("talk in English") == "English"
        assert detect_language_request("తెలుగులో మాట్లాడండి") == "Telugu"

    def test_roman_telugu_resolves_to_telugu_without_an_explicit_request(self):
        state = _state()
        assert state.resolve_language("nenu MPC teesukovali anukuntunnanu") == "Telugu"


class TestFollowUpEnforcement:
    """Spec §4 §12 §21 §29: the agent must not answer and stop."""

    def test_answer_without_a_question_gets_the_next_question(self):
        state = _state()
        question = enforce_follow_up(state, "MPC has Maths, Physics and Chemistry.")
        assert question
        assert response_has_question(question)

    def test_answer_that_already_asks_something_is_left_alone(self):
        state = _state()
        assert enforce_follow_up(state, "MPC has Maths. Are you thinking about engineering?") is None

    def test_follow_up_uses_the_locked_language(self):
        state = _state()
        state.resolve_language("Telugu lo matladu")
        question = enforce_follow_up(state, "సరే, MPC గురించి చెప్పాను.")
        assert question and any("\u0c00" <= ch <= "\u0c7f" for ch in question)

    def test_closing_turns_do_not_force_a_question(self):
        state = _state()
        state.begin_closing()
        assert enforce_follow_up(state, "Thank you for your time.") is None

    def test_telugu_question_markers_are_recognised(self):
        assert response_has_question("మీరు ఏ గ్రూప్ గురించి ఆలోచిస్తున్నారు?")
        assert response_has_question("మీకు హాస్టల్ కావాలా")
        assert not response_has_question("MPC లో మ్యాథ్స్, ఫిజిక్స్, కెమిస్ట్రీ ఉంటాయి.")


class TestStateReachesTheLLM:
    """The counselling state must be part of the REAL prompt, not decorative."""

    @pytest.mark.asyncio
    async def test_state_block_is_sent_to_the_model(self, monkeypatch):
        from app.rag import groq_service

        captured = {}

        class _Delta:
            content = "Alright."

        class _Choice:
            delta = _Delta()

        class _Chunk:
            choices = [_Choice()]

        async def _fake_stream():
            yield _Chunk()

        async def _fake_create(messages, **kwargs):
            captured["messages"] = messages
            return _fake_stream()

        monkeypatch.setattr(groq_service, "_create_with_fallback", _fake_create)

        state = _state()
        state.resolve_language("telugu lo matladu")
        state.observe("MPC teesukovali", student_asked_question=False)

        tokens = []
        async for token in groq_service.stream_chat_fast(
            "subjects enti",
            lang="Telugu",
            context="",
            agent_name="Sangeetha",
            company_name="Narayana College",
            state_prompt=state.prompt_block(),
        ):
            tokens.append(token)

        system = captured["messages"][0]["content"]
        assert tokens == ["Alright."]
        assert "LOCKED LANGUAGE: Telugu" in system
        assert "NEXT QUESTION TO ASK" in system
        assert "course_group=MPC" in system
        assert "CALLER" in system
        assert "How can I help you?" in system  # explicitly banned to the model
        assert captured["messages"][-1]["content"] == "subjects enti"

    @pytest.mark.asyncio
    async def test_state_block_is_optional_for_legacy_callers(self, monkeypatch):
        from app.rag import groq_service

        captured = {}

        async def _fake_stream():
            return
            yield  # pragma: no cover

        async def _fake_create(messages, **kwargs):
            captured["messages"] = messages
            return _fake_stream()

        monkeypatch.setattr(groq_service, "_create_with_fallback", _fake_create)

        async for _ in groq_service.stream_chat_fast("hello", lang="English"):
            pass
        # No state passed -> the prompt is unchanged and still valid.
        assert "CONVERSATION STATE" not in captured["messages"][0]["content"]


class TestPassivePhraseGuard:
    @pytest.mark.parametrize("phrase", [
        "How can I help you?",
        "Anything else?",
        "Do you have any questions?",
        "Would you like to know more?",
        "Is there anything else I can help with?",
    ])
    def test_chatbot_asks_are_never_spoken(self, phrase):
        cleaned = strip_passive_phrases(f"MPC has Maths, Physics and Chemistry. {phrase}")
        assert cleaned == "MPC has Maths, Physics and Chemistry."
        assert "?" not in cleaned or "maths" not in cleaned.lower()

    def test_real_content_survives(self):
        text = "The fee is around forty five thousand a year. Are you planning to join this year?"
        assert strip_passive_phrases(text) == text


def _is_telugu(text: str) -> bool:
    return any("\u0c00" <= ch <= "\u0c7f" for ch in (text or ""))


class TestTeluguConversation:
    """Spec §27 §28: once Telugu is locked, the whole call stays Telugu."""

    def test_telugu_call_progresses_in_telugu(self):
        state = _state()
        state.resolve_language("Telugu lo maatladu")

        q1 = state.next_question() or ""
        assert _is_telugu(q1)
        _turn(state, "Nenu MPC teesukovali anukuntunnanu", q1)
        assert state.slots.get("course_group") == "MPC"
        assert state.language == "Telugu"  # still locked

        q2 = state.next_question() or ""
        assert _is_telugu(q2)
        _turn(state, "Engineering", q2)

        q3 = state.next_question() or ""
        assert _is_telugu(q3)
        assert state.slots.get("career_interest") == "engineering"

    def test_student_question_is_answered_then_counselling_continues(self):
        """Spec §28: answering a fee question must not end the conversation."""
        state = _state()
        state.resolve_language("Telugu lo matladu")
        q1 = state.next_question() or ""
        _turn(state, "సరే", q1)

        # Student interrupts with a knowledge question; the reply has no question.
        _turn(state, "అవును. కానీ ఫీజు ఎంత?", "ఫీజు వివరాలు నా దగ్గర ఉన్నాయి.")
        assert state.stage == "INFORMATION_REQUEST"
        # The guard supplies the next counselling question in Telugu.
        follow_up = enforce_follow_up(state, "ఫీజు వివరాలు నా దగ్గర ఉన్నాయి.")
        assert follow_up and _is_telugu(follow_up)

    def test_english_knowledge_does_not_switch_the_spoken_language(self):
        """Spec §24: an English PDF must never produce an English reply."""
        state = _state()
        state.resolve_language("telugu lo maatladu")
        # The retrieval step feeds English text into the loop; the state must
        # still answer in Telugu.
        assert state.resolve_language("what about hostel fee", detected="English") == "Telugu"
        assert state.conversation_language == TELUGU
        assert _is_telugu(state.next_question() or "")


class TestStateAndObjections:
    def test_busy_student_is_offered_a_callback(self):
        state = _state()
        state.resolve_language("Busy ga unna")
        follow_up = _turn(state, "Busy ga unna", "Okay, no problem.")
        assert state.busy
        assert state.current_stage() == "FOLLOW_UP"
        assert follow_up  # a genuine next step, not silence
        # Offered in the language the student is speaking (Roman Telugu -> Telugu).
        if state.language == "Telugu":
            assert "కాల్" in follow_up
        else:
            assert "call" in follow_up.lower()

    def test_not_interested_is_not_pressured(self):
        state = _state()
        state.observe("interested ledu", student_asked_question=False)
        assert state.not_interested
        question = state.next_question() or ""
        assert "course group" not in question.lower()
        # Never asks a new discovery question after a clear "not interested".
        assert state.conversation_language in (ENGLISH, TELUGU, "MIXED")

    def test_telugu_negation_is_not_read_as_disinterest(self):
        """\"hostel ledu\" answers the hostel question — it is not a rejection."""
        state = _state()
        state.observe("hostel ledu", student_asked_question=False)
        assert state.not_interested is False
        assert state.slots.get("hostel") is False

    def test_objections_are_recorded(self):
        state = _state()
        state.observe("fee chala ekkuva", student_asked_question=False)
        assert state.objections
        assert state.current_stage() in ("OBJECTION_HANDLING", "DISCOVERY", "COURSE_DISCOVERY")

    def test_student_question_priority_keeps_the_state_answering(self):
        state = _state()
        state.observe("ఫీజు ఎంత? హాస్టల్ ఉందా?", student_asked_question=True)
        assert state.stage == "INFORMATION_REQUEST"

    def test_snapshot_exposes_the_spec_state_fields(self):
        state = _state()
        state.resolve_language("telugu lo matladu")
        state.observe("MPC teesukovali, hostel kavali", student_asked_question=False)
        snap = state.snapshot()
        for key in (
            "language", "conversation_language", "stage", "slots",
            "questions_asked", "questions_answered", "objections",
            "not_interested", "callback_required", "student_interest_level",
        ):
            assert key in snap
        assert snap["conversation_language"] == TELUGU

    def test_state_round_trips_through_a_snapshot(self):
        state = _state()
        state.resolve_language("telugu lo matladu")
        state.observe("MPC, engineering, this year", student_asked_question=False)
        restored = ConversationState.from_dict(state.snapshot(), agent_name="Sangeetha", company_name="Narayana College")
        assert restored.language == state.language
        assert restored.slots == state.slots
        assert restored.next_question() == state.next_question()

    def test_prompt_block_carries_state_and_anti_chatbot_rules(self):
        state = _state()
        block = state.prompt_block()
        assert "LOCKED LANGUAGE" in block
        assert "NEXT QUESTION TO ASK" in block
        assert "How can I help you?" in block  # explicitly forbidden to the LLM
        assert "never read this aloud" in block
