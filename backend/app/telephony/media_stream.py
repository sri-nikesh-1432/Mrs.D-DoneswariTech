"""
Twilio Media Streams WebSocket bridge (spec §24 §31-§32 §36 §58).

A REAL phone call is bridged here: Twilio Media Streams connects to
/api/telephony/media/{call_id} and streams the caller's audio as 8 kHz
µ-law frames inside JSON events. This module converts them to 16 kHz
PCM16, feeds them into the SAME voice-agent pipeline the browser preview
uses (VAD → Whisper STT → RAG → LLM → streaming TTS), and streams the
agent's TTS audio back to the phone.

Audio conversion (bidirectional):
  Phone (8 kHz µ-law) → PCM16 8k → PCM16 16k → VAD/STT/LLM/TTS pipeline
  Pipeline TTS (PCM 16k) → PCM16 8k → µ-law 8k → Twilio → caller's phone

One session = one live phone call. When Twilio ends the stream, the session
is finalized: the REAL transcript, measured latencies, real duration and a
post-call analysis are persisted so analytics reflect the actual call.
"""

import asyncio
import audioop
import base64
import json
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.logs.logger import get_logger
from app.database.connection import AsyncSessionLocal
from app.database.models import Institute, Student, CallHistory, TranscriptMessage, CallEvent

logger = get_logger(__name__)

router = APIRouter(tags=["Telephony Media"])

# ── Audio format constants ────────────────────────────────────────────────────
PHONE_RATE = 8000        # Twilio Media Streams sample rate
AGENT_RATE = 16000       # voice-agent pipeline sample rate
FRAME_MS = 20
ULAW_FRAME_BYTES = int(PHONE_RATE * FRAME_MS / 1000)   # 160 µ-law bytes per 20ms


def _ulaw_to_pcm16_16k(ulaw_bytes: bytes) -> bytes:
    """8 kHz µ-law → 16 kHz PCM16 (Twilio → agent)."""
    pcm8 = audioop.ulaw2lin(ulaw_bytes, 2)
    pcm16, _ = audioop.ratecv(pcm8, 2, 1, PHONE_RATE, AGENT_RATE, None)
    return pcm16


def _pcm16_16k_to_ulaw(pcm16_bytes: bytes) -> bytes:
    """16 kHz PCM16 → 8 kHz µ-law (agent → Twilio)."""
    pcm8, _ = audioop.ratecv(pcm16_bytes, 2, 1, AGENT_RATE, PHONE_RATE, None)
    return audioop.lin2ulaw(pcm8, 2)


# VAD parameters shared with the browser voice path.
from app.voice.voice_ws import (  # noqa: E402
    ENERGY_THRESHOLD, FRAME_SAMPLES, MIN_UTTERANCE_MS, MAX_UTTERANCE_SECONDS,
    TurnDetector, _is_noise, _is_backchannel, _is_echo,
)
from app.conversation.counsellor import (  # noqa: E402
    ConversationState, enforce_follow_up, outbound_greeting, response_has_question,
)

import numpy as np  # noqa: E402


class TelephonyVoiceSession:
    """
    One live phone call running through the real voice-agent pipeline
    (spec §16: preview and production share the same runtime).
    """

    def __init__(self, call_id: str, agent_id: int):
        self.call_id = call_id
        self.agent_id = agent_id

        self.agent: Optional[Institute] = None
        self.student: Optional[Student] = None
        self.agent_name = "Aadhya"
        self.company_name = "Doneswari"
        self.voice: Optional[str] = None
        self.language = "English"
        self.instructions: Optional[str] = None

        # Live counselling state: the phone agent drives the call exactly like
        # the browser preview (same stage flow, same language lock).
        self.conversation = ConversationState()

        self.memory: List[Dict] = []
        self.turn_latencies: List[Dict] = []
        self.started_at = time.time()
        self.answered_at: Optional[float] = None
        self._sequence = 0  # real per-call transcript sequence (spec §36)

    def _next_sequence(self) -> int:
        """Monotonic per-call transcript sequence — ordering must be reliable
        for transcript playback (spec §36: timestamp, speaker, text, sequence)."""
        self._sequence += 1
        return self._sequence

    async def resolve(self) -> bool:
        """Load agent + call + student rows from the DB."""
        async with AsyncSessionLocal() as session:
            self.agent = await session.get(Institute, self.agent_id)
            if not self.agent:
                return False
            self.agent_name = self.agent.agent_name or self.agent.name or "Aadhya"
            self.company_name = self.agent.name or "Doneswari"
            self.voice = self.agent.voice
            self.language = self.agent.language or "en"
            self.instructions = self.agent.instructions
            # The agent's configured language only SEEDS the call; once the
            # student states a preference the conversation locks to it.
            self.conversation = ConversationState(
                agent_name=self.agent_name,
                company_name=self.company_name,
            )

            res = await session.execute(
                select(CallHistory).where(CallHistory.call_id == self.call_id)
            )
            call = res.scalar_one_or_none()
            if call and call.student_id:
                self.student = await session.get(Student, call.student_id)
        return True

    async def agent_reply(self, user_text: str) -> Dict:
        """One REAL agent turn: per-agent RAG → grounded LLM → measured."""
        from app.rag.retriever import retrieve_context, format_context_for_prompt
        from app.rag.groq_service import stream_chat_fast

        t0 = time.time()
        chunks = await retrieve_context(user_text, top_k=4, agent_id=self.agent_id)
        context = format_context_for_prompt(chunks)
        retrieval_ms = round((time.time() - t0) * 1000, 1)

        # Language lock + fact extraction happen BEFORE generation so the
        # answer, the acknowledgement and the next question all use the
        # language the student asked for.
        self.conversation.observe(user_text, student_asked_question=response_has_question(user_text))
        lang_name = self.conversation.resolve_language(user_text, self._language_name())
        self.language = lang_name

        t1 = time.time()
        parts: List[str] = []
        async for delta in stream_chat_fast(
            user_text,
            lang=lang_name,
            conversation_history=self.memory[-8:],
            context=context,
            agent_name=self.agent_name,
            company_name=self.company_name,
            instructions=self.instructions,
            state_prompt=self.conversation.prompt_block(),
        ):
            parts.append(delta)
        reply = " ".join("".join(parts).split())
        llm_ms = round((time.time() - t1) * 1000, 1)

        if not reply:
            reply = (
                "I don't have the exact information available right now. "
                "I can help with what I have, or arrange for a counsellor to provide the exact details."
            )

        # The CALLER drives the call: if this turn asked nothing, the next
        # relevant counselling question is appended before it is spoken.
        follow_up = enforce_follow_up(self.conversation, reply)
        if follow_up:
            reply = f"{reply} {follow_up}"

        return {"text": reply, "retrieval_ms": retrieval_ms, "llm_ms": llm_ms}

    def _language_name(self) -> str:
        """Agent language code ("en") -> display name ("English")."""
        code = (self.language or "en").strip()
        if len(code) > 3:
            return code.capitalize()
        return {
            "en": "English", "te": "Telugu", "hi": "Hindi",
            "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam",
        }.get(code.lower(), "English")

    async def persist_turn(self, speaker: str, text: str, language: Optional[str] = None, latency_ms: Optional[int] = None) -> None:
        """Persist one transcript message immediately (real data, spec §36)."""
        try:
            async with AsyncSessionLocal() as session:
                session.add(TranscriptMessage(
                    call_id=self.call_id,
                    agent_id=self.agent_id,
                    sequence=self._next_sequence(),
                    speaker=speaker,
                    text=text,
                    language=language,
                    latency_ms=latency_ms,
                ))
                await session.commit()
        except Exception as e:
            logger.error("persist_turn failed (call=%s): %s", self.call_id, e)

    async def log_event(self, event_type: str, source: str, detail: Optional[Dict] = None) -> None:
        """Record a real call lifecycle event (spec §34)."""
        try:
            async with AsyncSessionLocal() as session:
                session.add(CallEvent(
                    call_id=self.call_id, event_type=event_type, source=source,
                    detail=detail or {},
                ))
                await session.commit()
        except Exception as e:
            logger.error("log_event failed (call=%s): %s", self.call_id, e)

    async def finalize(self) -> None:
        """Finalize from REAL data: transcript, analysis, counters (spec §37)."""
        try:
            from app.database.models import QuestionRanking
            from app.api.campaign_routes import analyze_conversation

            async with AsyncSessionLocal() as session:
                res = await session.execute(
                    select(TranscriptMessage).where(TranscriptMessage.call_id == self.call_id)
                )
                msgs = res.scalars().all()
                if not msgs:
                    logger.info("TELEPHONY_FINALIZE | call=%s empty transcript; skipping", self.call_id)
                    return
                msgs.sort(key=lambda m: m.id)
                full_transcript = "\n".join(f"{m.speaker}: {m.text}" for m in msgs)

            duration = int(time.time() - (self.answered_at or self.started_at))
            analysis = await analyze_conversation(
                full_transcript, self.agent_name,
                self.student.name if self.student else "Caller",
                self.student.preferred_course if self.student else None,
            )

            lat = self.turn_latencies
            avg = lambda k: round(sum(x[k] for x in lat) / len(lat), 1) if lat else None

            async with AsyncSessionLocal() as session:
                res = await session.execute(
                    select(CallHistory).where(CallHistory.call_id == self.call_id)
                )
                call = res.scalar_one_or_none()
                if not call:
                    return
                now = datetime.now(timezone.utc)
                call.ended_at = now
                call.duration_seconds = duration
                call.call_status = "Callback Requested" if analysis.get("callback_requested") else "Completed"
                call.transcript = full_transcript
                call.summary = analysis.get("summary")
                call.questions_asked = analysis.get("questions_asked", [])
                call.objections = analysis.get("objections", [])
                call.interest_level = analysis.get("interest_level", "Unclear")
                call.outcome = analysis.get("outcome", "Call Completed")
                call.callback_requested = bool(analysis.get("callback_requested"))
                call.avg_retrieval_time_ms = avg("retrieval_ms")
                call.avg_llm_response_time_ms = avg("llm_ms")
                call.avg_stt_time_ms = avg("stt_ms")
                call.total_latency_ms = round(
                    (avg("retrieval_ms") or 0) + (avg("llm_ms") or 0) + (avg("stt_ms") or 0), 1
                )
                call.total_turns = len(msgs)

                agent = await session.get(Institute, self.agent_id)
                if agent:
                    agent.total_calls = (agent.total_calls or 0) + 1
                    agent.completed_calls = (agent.completed_calls or 0) + 1
                    agent.total_duration_seconds = (agent.total_duration_seconds or 0) + duration
                    lvl = analysis.get("interest_level", "Unclear")
                    if lvl == "Interested":
                        agent.interested_count = (agent.interested_count or 0) + 1
                    elif lvl == "Not Interested":
                        agent.not_interested_count = (agent.not_interested_count or 0) + 1
                    elif lvl == "Needs Follow-up":
                        agent.follow_up_count = (agent.follow_up_count or 0) + 1
                    elif lvl == "Callback Requested":
                        agent.callback_count = (agent.callback_count or 0) + 1

                if self.student:
                    student = await session.get(Student, self.student.id)
                    if student:
                        student.call_status = call.call_status
                        student.interest_level = analysis.get("interest_level", "Unclear")
                        student.duration_seconds = duration
                        student.questions_asked = analysis.get("questions_asked", [])
                        student.objections = analysis.get("objections", [])
                        student.callback_requested = bool(analysis.get("callback_requested"))
                        student.outcome = analysis.get("outcome", "Call Completed")

                for q in analysis.get("questions_asked", []):
                    if not q:
                        continue
                    existing = await session.execute(
                        select(QuestionRanking).where(
                            QuestionRanking.agent_id == self.agent_id,
                            QuestionRanking.question_text == q,
                        )
                    )
                    qr = existing.scalar_one_or_none()
                    if qr:
                        qr.count = (qr.count or 1) + 1
                        qr.last_asked_at = now
                    else:
                        session.add(QuestionRanking(
                            agent_id=self.agent_id, question_text=q, count=1, last_asked_at=now,
                        ))

                session.add(CallEvent(
                    call_id=self.call_id, event_type="completed", source="pipeline",
                    detail={"duration": duration},
                ))
                await session.commit()

            logger.info(
                "TELEPHONY_FINALIZE | call=%s | %s | duration=%ds",
                self.call_id, analysis.get("interest_level"), duration,
            )
        except Exception as e:
            logger.exception("TELEPHONY_FINALIZE failed (call=%s): %s", self.call_id, e)


@router.websocket("/api/telephony/media/{call_id}")
async def twilio_media_stream(websocket: WebSocket, call_id: str):
    """
    Bidirectional media bridge for a REAL phone call. Twilio streams the
    caller as 8 kHz µ-law; we answer with the agent's TTS as µ-law frames.
    """
    await websocket.accept()
    logger.info("TWILIO_MEDIA_CONNECT | call=%s", call_id)

    stream_sid = ""
    agent_id = 1

    # Audio/VAD state.
    turn_detector = TurnDetector()
    pcm_buffer = bytearray()
    speech_started = False
    utterance_frames = 0
    max_utterance_frames = int(MAX_UTTERANCE_SECONDS * 1000 / FRAME_MS)
    pre_speech_buffer = bytearray()

    # Agent speech state (for barge-in).
    agent_speaking = asyncio.Event()
    barge_in = asyncio.Event()
    agent_speech_started_at = 0.0
    speech_frames_during_agent = 0

    session: Optional[TelephonyVoiceSession] = None
    utterance_q: asyncio.Queue = asyncio.Queue()
    worker_task = None

    async def _synthesize_pcm(text: str) -> Optional[bytes]:
        """Agent TTS → raw PCM16 @16 kHz (via the PCM-configured Edge socket)."""
        from app.tts.edge_tts_service import get_tts_service
        tts = get_tts_service()
        return await tts.synthesize_pcm(text, voice=session.voice, language=session.language)

    async def _stream_audio_to_phone(pcm16: bytes) -> bool:
        """Stream PCM16 16k audio to Twilio as 20 ms µ-law frames, in real time.
        Returns False if barge-in cancelled playback."""
        try:
            ulaw = _pcm16_16k_to_ulaw(pcm16)
            for i in range(0, len(ulaw), ULAW_FRAME_BYTES):
                if barge_in.is_set():
                    return False
                frame = ulaw[i:i + ULAW_FRAME_BYTES].ljust(ULAW_FRAME_BYTES, b"\xff")
                await websocket.send_json({
                    "event": "media",
                    "streamSid": stream_sid,
                    "media": {"payload": base64.b64encode(frame).decode("ascii")},
                })
                await asyncio.sleep(FRAME_MS / 1000.0)
            return True
        except Exception as e:
            logger.debug("send_audio ended (call=%s): %s", call_id, e)
            return False

    async def _speak_text(text: str, speaker: str = "agent", latency_ms: Optional[int] = None) -> None:
        """Speak one line to the caller with barge-in support."""
        nonlocal agent_speech_started_at
        pcm = await _synthesize_pcm(text)
        if not pcm:
            return
        agent_speaking.set()
        barge_in.clear()
        agent_speech_started_at = time.time()
        try:
            await _stream_audio_to_phone(pcm)
        finally:
            agent_speaking.clear()
            barge_in.clear()

    async def _process_utterance(pcm16_bytes: bytes) -> None:
        """STT → phantom filters → agent reply → speak (the real runtime)."""
        nonlocal session
        pcm_float = np.frombuffer(bytes(pcm16_bytes), dtype=np.int16).astype(np.float32) / 32768.0
        if pcm_float.size < 800:
            return

        t_stt = time.time()
        from app.voice.voice_ws import _transcribe_pcm
        try:
            stt = await _transcribe_pcm(pcm_float)
        except Exception as e:
            logger.error("Telephony STT failed (call=%s): %s", call_id, e)
            return
        stt_ms = round((time.time() - t_stt) * 1000)
        user_text = (stt.get("text") or "").strip()
        if not user_text:
            return

        # Phantom-input prevention (same rules as the browser path).
        last_ai = next((m["content"] for m in reversed(session.memory) if m.get("role") == "assistant"), "")
        if _is_noise(user_text) or _is_backchannel(user_text) or _is_echo(user_text, last_ai):
            logger.info("Telephony filtered utterance (call=%s): %.40s", call_id, user_text)
            return

        detected_lang = stt.get("language", "en")
        await session.persist_turn("user", user_text, language=detected_lang)
        session.memory.append({"role": "user", "content": user_text})

        reply_data = await session.agent_reply(user_text)
        reply = reply_data["text"]
        latency_ms = int(reply_data["retrieval_ms"] + reply_data["llm_ms"] + stt_ms)
        session.turn_latencies.append({
            "stt_ms": stt_ms,
            "retrieval_ms": reply_data["retrieval_ms"],
            "llm_ms": reply_data["llm_ms"],
        })
        session.memory.append({"role": "assistant", "content": reply})
        await session.persist_turn("agent", reply, language=session.language, latency_ms=latency_ms)

        await _speak_text(reply, latency_ms=latency_ms)

    async def _worker():
        """Sequential utterance processor."""
        while True:
            pcm = await utterance_q.get()
            try:
                await _process_utterance(pcm)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("Telephony worker error (call=%s): %s", call_id, e)
            finally:
                utterance_q.task_done()

    try:
        # --- handshake: Twilio "start" event carries custom parameters ---
        first = await asyncio.wait_for(websocket.receive(), timeout=15.0)
        if first.get("text"):
            evt = json.loads(first["text"])
            if evt.get("event") == "start":
                start = evt.get("start", {})
                stream_sid = start.get("streamSid", "")
                custom = start.get("customParameters") or start.get("customParams") or {}
                try:
                    agent_id = int(custom.get("agent_id") or 1)
                except (TypeError, ValueError):
                    agent_id = 1

        session = TelephonyVoiceSession(call_id, agent_id)
        if not await session.resolve():
            logger.error("TWILIO_MEDIA | call=%s agent %d not found", call_id, agent_id)
            await websocket.close()
            return

        # Mark the call ANSWERED — a real event from the media stream opening.
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(CallHistory).where(CallHistory.call_id == call_id))
            call = res.scalar_one_or_none()
            if call:
                call.answered_at = now
                call.call_status = "In Progress"
                await db.commit()
        session.answered_at = time.time()
        await session.log_event("in_progress", "pipeline", {"stream_sid": stream_sid})

        worker_task = asyncio.create_task(_worker())

        # --- greeting (real configured greeting) ---
        # OUTBOUND opener: introduce, then ask permission. If the tenant's
        # script doesn't ask anything, the permission question is appended so
        # the call never opens like a customer-support chatbot.
        greeting = (session.agent.greeting_message or "").strip()
        if not greeting:
            greeting = outbound_greeting(session.agent_name, session.company_name, session.language)
        elif not response_has_question(greeting):
            greeting = (
                f"{greeting.rstrip()} "
                f"{outbound_greeting(session.agent_name, session.company_name, session.language).split('. ', 1)[-1]}"
            )
        session.conversation.language = session.language
        session.conversation.stage = "PERMISSION"
        await session.persist_turn("agent", greeting, language=session.language)
        session.memory.append({"role": "assistant", "content": greeting})
        await _speak_text(greeting)

        # --- main receive loop ---
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            raw = msg.get("text")
            if raw is None:
                continue
            try:
                evt = json.loads(raw)
            except Exception:
                continue

            event = evt.get("event")

            if event == "stop":
                logger.info("TWILIO_MEDIA | stream stop (call=%s)", call_id)
                break

            if event != "media":
                continue

            payload = evt.get("media", {}).get("payload")
            if not payload:
                continue
            try:
                ulaw = base64.b64decode(payload)
            except Exception:
                continue

            pcm16 = _ulaw_to_pcm16_16k(ulaw)
            pcm_float = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
            rms = float(np.sqrt(np.mean(pcm_float ** 2))) if pcm_float.size else 0.0
            is_speech = rms > ENERGY_THRESHOLD

            # ── Barge-in: caller speech while agent speaks cancels TTS ──
            # 120 ms of sustained speech (6 frames) after a 400 ms grace
            # period (line echo settle) = genuine interruption (spec §21-§22).
            if agent_speaking.is_set():
                if is_speech and time.time() - agent_speech_started_at > 0.4:
                    speech_frames_during_agent += 1
                    if speech_frames_during_agent >= 6:
                        barge_in.set()
                        agent_speaking.clear()
                        speech_frames_during_agent = 0
                elif not is_speech:
                    speech_frames_during_agent = max(0, speech_frames_during_agent - 1)

            # ── VAD accumulation ──
            if is_speech:
                if not speech_started:
                    speech_started = True
                    pcm_buffer.extend(pre_speech_buffer)
                    pre_speech_buffer.clear()
                pcm_buffer.extend(pcm16)
                utterance_frames += 1
                turn_detector.update(True)
                if utterance_frames >= max_utterance_frames:
                    utterance_q.put_nowait(bytes(pcm_buffer))
                    pcm_buffer.clear()
                    speech_started = False
                    utterance_frames = 0
                    turn_detector.reset()
            elif speech_started:
                pcm_buffer.extend(pcm16)
                utterance_frames += 1
                if turn_detector.update(False):
                    if len(pcm_buffer) >= (MIN_UTTERANCE_MS / FRAME_MS) * FRAME_SAMPLES * 2:
                        utterance_q.put_nowait(bytes(pcm_buffer))
                    pcm_buffer.clear()
                    speech_started = False
                    utterance_frames = 0
                    turn_detector.reset()
            else:
                # Keep a short pre-speech ring so utterance onsets aren't clipped.
                pre_speech_buffer.extend(pcm16)
                if len(pre_speech_buffer) > (200 / FRAME_MS) * FRAME_SAMPLES * 2:
                    del pre_speech_buffer[: (100 / FRAME_MS) * FRAME_SAMPLES * 2]

    except WebSocketDisconnect:
        logger.info("TWILIO_MEDIA_DISCONNECT | call=%s", call_id)
    except asyncio.TimeoutError:
        logger.error("TWILIO_MEDIA handshake timeout (call=%s)", call_id)
    except Exception as e:
        logger.exception("TWILIO_MEDIA error (call=%s): %s", call_id, e)
    finally:
        if worker_task:
            worker_task.cancel()
            try:
                await worker_task
            except (asyncio.CancelledError, Exception):
                pass
        if session:
            await session.finalize()
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("TWILIO_MEDIA_CLOSED | call=%s", call_id)
