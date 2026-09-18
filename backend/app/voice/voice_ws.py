"""
WebSocket Voice Agent - Retell AI-level real-time voice conversation.

Persistent bidirectional WebSocket:
  Client -> Server: PCM 16 kHz mono audio frames (binary) + JSON control msgs
  Server -> Client: JSON control messages + base64 MP3 sentence audio

Pipeline (server-side):
  Energy VAD -> Groq Whisper STT -> Groq LLM (streaming) -> Edge-TTS (per sentence)

This eliminates per-turn HTTP overhead and moves VAD + STT to the server
for lower latency - matching Retell AI's architecture.

Protocol:
  Client connects to  /ws/voice/{agent_id}
  Client sends JSON:  {"type": "hello", mode, knowledge_file, institute_id,
                       language, conversation_id, memory}
  Server replies:     {"type": "connected", conversation_id}
  Server streams greeting sentences, then {"type": "turn_done"}
  Client streams binary PCM16 @16 kHz mono frames.
  Server VAD-detects the utterance end -> STT -> LLM -> streamed TTS sentences.
  Client can send   : {"type": "text", "text": "..."}  (typed input, skips STT)
                      {"type": "end"}                  (graceful close)
                      {"type": "ping"}                 (keepalive)
"""

import asyncio
import base64  # noqa: F401  (kept for parity with SSE payloads)
import io
import json
import random
import re as _re
import struct
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config.settings import settings
from app.logs.logger import get_logger
from app.rag.groq_service import generate_response, stream_chat_fast
from app.rag.retriever import retrieve_context, format_context_for_prompt
from app.rag.json_retriever import get_json_retriever
from app.tts.edge_tts_service import get_tts_service
from app.roman_telugu import looks_roman_telugu, transliterate_roman_telugu
from app.reports.call_report_service import generate_report_data

logger = get_logger(__name__)

router = APIRouter(tags=["Voice WebSocket"])


# ---------------------------------------------------------------------------
# Phantom Input Prevention (spec §6, §10, §20, §21, §48)
# ---------------------------------------------------------------------------

# Backchannel tokens - sounds that mean "I'm listening" NOT "I want the floor"
BACKCHANNEL_TOKENS = {
    "mm", "mhm", "mhmm", "hmm", "hm", "uh", "um", "umm", "aah", "ah",
    "oh", "ok", "okay", "okayyy", "right", "yes", "yeah", "yep", "yup",
    "haa", "ha", "aha", "haan", "huh", "haanji", "accha", "achha",
    "okie", "k", "kk", "cool", "fine", "got it", "alright", "sure",
    "avunu", "avuna", "avn", "alage", "alaga", "sare", "sar", "sari",
    "sarle", "parledu", "parledhu", "parled", "baane", "bavundi",
    "సరే", "అవును", "అలాగే", "సర్లే", "పర్లేదు", "ఓహ్", "అవునా", "హ్మ్",
    "theek", "theek hai", "theekhai", "hmm hmm",
}

# Genuine interruption words - these mean "stop, I want the floor"
INTERRUPTION_TOKENS = {
    "wait", "waitwait", "stop", "hold", "minute", "min", "ledu", "ledhu",
    "no", "na", "actually", "listen", "sorry", "aa", "ఆగండి", "లేదు",
    "ఒక్క నిమిషం", "నిమిషం", "చెప్పండి", "అడగనా", "మధ్యలో", "mundu",
    "mundhu", "malli", "okk", "okkanimisham", "adaganu", "adagana",
}

# Noise tokens - non-speech sounds
NOISE_TOKENS = {
    "a", "aa", "aaa", "e", "ee", "eee", "u", "uu", "o", "oo", "er",
    "eh", "huh", "huhh", "tch", "tsk", "psst", "click", "clk", "beep",
    "music", "song", "applause", "silence", "background", "noise",
    "[music]", "[noise]", "[silence]", "[applause]", "[laughter]",
    "(music)", "(noise)", "(silence)", "(applause)", "(laughter)",
}


def _is_backchannel(text: str) -> bool:
    """True if the utterance is just backchannel filler."""
    text = text.strip().lower()
    tokens = _re.sub(r"[.,!?…\-]", " ", text).split()
    if not tokens:
        return False
    # Any interruption word = NOT a backchannel
    if any(t in INTERRUPTION_TOKENS for t in tokens):
        return False
    return all(t in BACKCHANNEL_TOKENS for t in tokens)


def _is_noise(text: str) -> bool:
    """True if the text is empty, punctuation, or noise."""
    text = text.strip()
    if not text:
        return True
    # Keep letters + digits only. Python `re` has no \p{L}; \w with UNICODE
    # covers letters (any script) + digits + underscore (stripped by the
    # token check below).
    letters = _re.sub(r"[\W_]+", "", text, flags=_re.UNICODE)
    if len(letters) < 2:
        return True
    tokens = text.lower().split()
    if len(tokens) == 1:
        t = _re.sub(r"[.,!?…]", "", tokens[0])
        if _re.match(r"^(.)\1{2,}$", t):
            return True
        if t in NOISE_TOKENS:
            return True
    return False


def _is_echo(text: str, last_ai_text: str) -> bool:
    """True if text is an echo of the AI's last spoken words."""
    text = text.strip().lower()
    ai = (last_ai_text or "").strip().lower()
    if not text or not ai or len(text) < 10:
        return False
    text_words = text.split()
    ai_words = set(ai.split())
    if len(text_words) < 4:
        return False
    # Heavy overlap (≥ 75% of words match)
    hits = sum(1 for w in text_words if w in ai_words)
    if hits / len(text_words) >= 0.75:
        return True
    # Long verbatim tail
    if len(text_words) >= 5 and text in ai:
        return True
    return False


# Audio response cache: first-sentence MP3 (base64) keyed like the text
# cache, so repeat questions skip TTS synthesis entirely (~0ms first audio).
_AUDIO_CACHE: dict = {}
_AUDIO_CACHE_MAX = 200


def _audio_key(query: str, institute_id: int) -> str:
    normalized = " ".join(query.lower().split())[:120]
    return f"{institute_id}:{normalized}"


def _audio_cache_get(key: str) -> Optional[str]:
    return _AUDIO_CACHE.get(key)


def _audio_cache_put(key: str, audio_b64: str) -> None:
    if len(_AUDIO_CACHE) >= _AUDIO_CACHE_MAX:
        _AUDIO_CACHE.pop(next(iter(_AUDIO_CACHE)), None)
    _AUDIO_CACHE[key] = audio_b64


class DuplicateTracker:
    """Track processed utterances to prevent duplicate processing (per session)."""

    def __init__(self, window_seconds: int = 8):
        self.recent: list = []  # (utterance_id, normalized_text, timestamp)
        self.window = window_seconds
        self.counter = 0

    @staticmethod
    def _normalize(text: str) -> str:
        return _re.sub(r"\s+", " ", text.strip().lower())

    def should_process(self, text: str) -> tuple:
        """Returns (should_process, utterance_id)."""
        now = time.time()
        normalized = self._normalize(text)

        self.recent = [
            (uid, norm, ts) for uid, norm, ts in self.recent
            if now - ts < self.window
        ]

        for uid, norm, _ in self.recent:
            if norm == normalized:
                logger.info("Duplicate utterance ignored: %s", text[:50])
                return False, ""

        self.counter += 1
        utterance_id = f"utt_{self.counter}"
        self.recent.append((utterance_id, normalized, now))
        return True, utterance_id


# ---------------------------------------------------------------------------
# Latency Instrumentation (spec §27, §34)
# ---------------------------------------------------------------------------

class LatencyTracker:
    """Track latency metrics for the voice pipeline."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.turn_start = 0.0
        self.stt_start = 0.0
        self.stt_end = 0.0
        self.rag_start = 0.0
        self.rag_end = 0.0
        self.llm_start = 0.0
        self.llm_first_token = 0.0
        self.llm_end = 0.0
        self.tts_start = 0.0
        self.tts_first_audio = 0.0
        self.tts_end = 0.0
        self.speech_end = 0.0

    def start_turn(self):
        self.turn_start = time.time()

    def mark_speech_end(self):
        self.speech_end = time.time()

    def start_stt(self):
        self.stt_start = time.time()

    def end_stt(self):
        self.stt_end = time.time()

    def start_rag(self):
        self.rag_start = time.time()

    def end_rag(self):
        self.rag_end = time.time()

    def start_llm(self):
        self.llm_start = time.time()

    def mark_llm_first_token(self):
        if self.llm_first_token == 0.0:
            self.llm_first_token = time.time()

    def end_llm(self):
        self.llm_end = time.time()

    def start_tts(self):
        self.tts_start = time.time()

    def mark_tts_first_audio(self):
        if self.tts_first_audio == 0.0:
            self.tts_first_audio = time.time()

    def end_tts(self):
        self.tts_end = time.time()

    def get_metrics(self) -> dict:
        metrics = {}
        if self.stt_start > 0 and self.stt_end > 0:
            metrics["stt_ms"] = round((self.stt_end - self.stt_start) * 1000)
        if self.rag_start > 0 and self.rag_end > 0:
            metrics["rag_ms"] = round((self.rag_end - self.rag_start) * 1000)
        if self.llm_start > 0:
            if self.llm_first_token > 0:
                metrics["llm_ttft_ms"] = round((self.llm_first_token - self.llm_start) * 1000)
            if self.llm_end > 0:
                metrics["llm_total_ms"] = round((self.llm_end - self.llm_start) * 1000)
        if self.tts_start > 0:
            if self.tts_first_audio > 0:
                metrics["tts_first_audio_ms"] = round((self.tts_first_audio - self.tts_start) * 1000)
            if self.tts_end > 0:
                metrics["tts_total_ms"] = round((self.tts_end - self.tts_start) * 1000)
        if self.speech_end > 0 and self.tts_first_audio > 0:
            metrics["ttfa_ms"] = round((self.tts_first_audio - self.speech_end) * 1000)
        if self.turn_start > 0 and self.tts_end > 0:
            metrics["total_turn_ms"] = round((self.tts_end - self.turn_start) * 1000)
        return metrics


# ---------------------------------------------------------------------------
# Language detection with stability and confidence tracking (spec §13, §14)
# ---------------------------------------------------------------------------

class LanguageDetector:
    """Detect and stabilize language across conversation turns."""

    def __init__(self, history_size: int = 5):
        self.history: list = []
        self.history_size = history_size
        self.current_language = "English"
        self.language_confidence = 0.0

    def detect(self, user_input: str, stt_language: Optional[str] = None) -> str:
        detected = self._detect_single(user_input, stt_language)
        self.history.append(detected)
        if len(self.history) > self.history_size:
            self.history.pop(0)

        if len(self.history) >= 2:
            counts = {}
            for lang in self.history:
                counts[lang] = counts.get(lang, 0) + 1
            most_common = max(counts, key=counts.get)
            confidence = counts[most_common] / len(self.history)
            if confidence >= 0.6:
                self.current_language = most_common
                self.language_confidence = confidence
        else:
            self.current_language = detected
            self.language_confidence = 0.5
        return self.current_language

    def _detect_single(self, user_input: str, stt_language: Optional[str] = None) -> str:
        if stt_language:
            stt_lang = stt_language.lower()
            if stt_lang in ("te", "telugu"):
                return "Telugu"
            if stt_lang in ("hi", "hindi"):
                return "Hindi"
            if stt_lang in ("ta", "tamil"):
                return "Tamil"
            if stt_lang in ("kn", "kannada"):
                return "Kannada"
            if stt_lang in ("ml", "malayalam"):
                return "Malayalam"
        if _re.search(r"[\u0C00-\u0C7F]", user_input):
            return "Telugu"
        if looks_roman_telugu(user_input):
            return "Telugu"
        if _re.search(r"[\u0900-\u097F]", user_input):
            return "Hindi"
        if _re.search(r"[\u0B80-\u0BFF]", user_input):
            return "Tamil"
        if _re.search(r"[\u0C80-\u0CFF]", user_input):
            return "Kannada"
        if _re.search(r"[\u0D00-\u0D7F]", user_input):
            return "Malayalam"
        return "English"


def _detect_language(user_input: str, hint: Optional[str] = None) -> str:
    """Thin wrapper over a fresh LanguageDetector for callers that import from
    voice_ws (e.g. analytics latency-test) without depending on the SSE route
    helpers.
    """
    return LanguageDetector().detect(user_input, stt_language=hint)


# Compatibility aliases for legacy importers (app.api.analytics_routes).
# The analytics latency-test imports these by name but does not call them.
_process_utterance = None  # replaced by _process_turn (WebSocket-aware)
_language_detector = LanguageDetector()


# ---------------------------------------------------------------------------
# Natural pause calculation (human breathing cadence)
# ---------------------------------------------------------------------------

def _natural_pause_ms(sentence: str) -> int:
    """Natural breathing pause after a sentence (used by non-WS callers)."""
    s = sentence.strip()
    if s.endswith("?"):
        return 450 + int(random.random() * 200)
    if s.endswith("!"):
        return 350 + int(random.random() * 150)
    if s.endswith("..."):
        return 500 + int(random.random() * 200)
    if len(s) > 120:
        return 400 + int(random.random() * 200)
    if len(s) < 25:
        return 250 + int(random.random() * 150)
    return 300 + int(random.random() * 200)


# ---------------------------------------------------------------------------
# Sentence boundary detector (shared logic with conversation_routes)
# ---------------------------------------------------------------------------

_SENT_BOUNDARY = _re.compile(r"[.!?](?=\s|$|\n)|\n")

# First-chunk boundary: break aggressively (sentence end, comma, colon or
# dash) so TTS starts on a SHORT first unit. Short first synth ≈ 300ms vs
# ≈ 600ms for a full sentence — the biggest TTFA lever.
_FIRST_CLAUSE_BOUNDARY = _re.compile(r"[.!?:;](?=\s|$)|,\s|\s[-–—]\s|\n")
# Fallback cap: if no punctuation arrives, cut the first chunk at ~40 chars
# (at a word boundary) so the first synth is never long.
_FIRST_CHUNK_MAX_CHARS = 40


def _pop_complete_sentences(buffer: str):
    """Return (complete_sentences, remainder) from a streaming buffer."""
    sentences = []
    start = 0
    for m in _SENT_BOUNDARY.finditer(buffer):
        end = m.end()
        piece = buffer[start:end].strip()
        if piece:
            sentences.append(piece)
        start = end
    return sentences, buffer[start:]


def _build_history(memory: list) -> list:
    """Build LLM history from a [{role, content}] memory list.

    Keeps the last 8 turns and adds a context hint so follow-ups
    ("hostel?") inherit the previously discussed institute/course.
    """
    history = []
    for m in memory:
        role = m.get("role") or "assistant"
        content = str(m.get("content") or "")
        if not content.strip():
            continue
        if len(content) > 300:
            content = content[:297].rstrip() + "..."
        history.append({"role": role, "content": content})

    recent = history[-8:]
    if recent:
        recent = [{
            "role": "system",
            "content": (
                "CONVERSATION CONTEXT: You are in an ongoing conversation. "
                "Understand follow-up questions without asking for clarification again. "
                "If the user asks about 'fee', 'hostel', 'transport', etc., assume they "
                "mean the same institution/course previously discussed."
            ),
        }] + recent
    return recent


# ---------------------------------------------------------------------------
# Server-side VAD parameters (spec §10)
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16000
FRAME_MS = 20  # 20 ms per frame
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)  # 320 samples
# RMS below this = silence. Deliberately LOW so soft/quiet callers are still
# detected; adaptive baseline + echo-cancellation on the mic protect against
# noise triggering phantom turns.
ENERGY_THRESHOLD = 0.008

SILENCE_FRAMES_SHORT = 25   # ~500ms - short utterances
SILENCE_FRAMES_MEDIUM = 40  # ~800ms - normal pauses
SILENCE_FRAMES_LONG = 60    # ~1200ms - thinking pauses

MAX_UTTERANCE_SECONDS = 30  # hard cap
PRE_SPEECH_MS = 200
MIN_UTTERANCE_MS = 320      # shorter than this = click/noise, drop


class TurnDetector:
    """Adaptive turn detection: silence threshold scales with utterance length."""

    def __init__(self):
        self.speech_frames = 0
        self.silence_frames = 0
        self.current_threshold = SILENCE_FRAMES_MEDIUM

    def update(self, is_speech: bool) -> bool:
        """Update state. Returns True when the turn should end."""
        if is_speech:
            self.speech_frames += 1
            self.silence_frames = 0
            return False
        self.silence_frames += 1
        if self.speech_frames < 30:          # < 600ms
            self.current_threshold = SILENCE_FRAMES_SHORT
        elif self.speech_frames < 100:       # < 2s
            self.current_threshold = SILENCE_FRAMES_MEDIUM
        else:                                # long utterance
            self.current_threshold = SILENCE_FRAMES_LONG
        return self.silence_frames >= self.current_threshold

    def reset(self):
        self.speech_frames = 0
        self.silence_frames = 0
        self.current_threshold = SILENCE_FRAMES_MEDIUM


# ---------------------------------------------------------------------------
# PCM -> Groq Whisper transcription
# ---------------------------------------------------------------------------

def _pcm_to_wav(pcm_int16: np.ndarray) -> bytes:
    """Wrap raw PCM int16 samples into a minimal in-memory WAV file."""
    pcm_bytes = pcm_int16.astype(np.int16).tobytes()
    wav_buf = io.BytesIO()
    num_channels = 1
    sample_width = 2
    data_rate = SAMPLE_RATE * num_channels * sample_width
    wav_buf.write(b"RIFF")
    wav_buf.write(struct.pack("<I", 36 + len(pcm_bytes)))
    wav_buf.write(b"WAVE")
    wav_buf.write(b"fmt ")
    wav_buf.write(struct.pack(
        "<IHHIIHH",
        16, 1, num_channels, SAMPLE_RATE, data_rate,
        num_channels * sample_width, 16,
    ))
    wav_buf.write(b"data")
    wav_buf.write(struct.pack("<I", len(pcm_bytes)))
    wav_buf.write(pcm_bytes)
    return wav_buf.getvalue()


async def _transcribe_pcm(pcm_float: np.ndarray) -> dict:
    """Transcribe PCM float32 samples via Groq Whisper."""
    from app.stt.groq_stt import transcribe_audio as groq_transcribe

    pcm_int16 = np.clip(pcm_float * 32768, -32768, 32767).astype(np.int16)
    wav_bytes = _pcm_to_wav(pcm_int16)
    return await groq_transcribe(wav_bytes, filename="utterance.wav")


# ---------------------------------------------------------------------------
# WebSocket greeting
# ---------------------------------------------------------------------------

GREETING_OPENERS: list[str] = [
    "Hi, thanks for taking my call. I'm Mrs. D, and I wanted to quickly check in with you today.",
    "Hello there! This is Mrs. D — do you have a minute for a quick chat?",
    "Hey, I hope I'm not catching you at a bad time. I'm Mrs. D, and I just wanted to speak with you briefly.",
    "Hi, good to reach you. I'm Mrs. D — I'll keep this short, I promise.",
    "Hello! This is Mrs. D. If you've got a moment, I'd love to tell you a little about what we offer.",
    "Hi, this is Mrs. D. Am I speaking with the right person?",
    "Hello, thanks for picking up. I'm Mrs. D — I'll be brief, I promise.",
    "Hi there! Mrs. D here. If now's not a good time, I can try another day.",
    "Hello! This is Mrs. D. I was just calling to share something that might interest you.",
    "Hi, I hope I'm not disturbing you. I'm Mrs. D — got a minute?",
]


async def _send_greeting(
    websocket: WebSocket,
    mode: str,
    knowledge_file: str,
    institute_id: int,
    language: str,
    memory: list,
    persona: Optional[dict] = None,
):
    """Send the initial greeting over WebSocket (streams sentence audio).

    Persona is resolved from the agent DB row so the greeting uses the
    agent's OWN name, company, greeting script and TTS voice — never the
    hardcoded Mrs. D default.
    """
    persona = persona or {}
    agent_name = persona.get("agent_name") or "Aadhya"
    company_name = persona.get("company_name") or "Doneswari"
    voice = persona.get("voice")
    try:
        turn_start = time.time()
        logger.info("WS_GREETING | stage=start mode=%s agent=%d persona=%s", mode, institute_id, agent_name)

        # Prefer the agent's configured greeting script — zero LLM latency.
        ai_response = (persona.get("greeting_message") or "").strip()

        if not ai_response and mode == "test":
            retriever = get_json_retriever(knowledge_file)
            ai_response = retriever.get_greeting(language=language)
            logger.info("WS_GREETING | stage=json_greeting len=%d", len(ai_response or ""))

        if not ai_response and mode != "test":
            # Fall back to a short LLM-personalised greeting grounded in the
            # agent's knowledge base (bounded to keep TTFA low).
            try:
                retrieved_chunks = await retrieve_context(
                    "institute name college school courses", top_k=5, min_score=0.1,
                    agent_id=institute_id,
                )
                context_text = format_context_for_prompt(retrieved_chunks)
                greeting_prompt = (
                    f"You are {agent_name}, a warm admissions counsellor calling on behalf of {company_name}. "
                    f"In {language}, greet the caller warmly in ONE short sentence, introduce yourself as "
                    f"{agent_name} from {company_name}, and ask how you can help with admissions. "
                    f"Maximum 2 sentences. Sound like a real person on a phone call."
                )
                ai_response = await generate_response(
                    conversation_history=[],
                    context=context_text or "",
                    user_message=greeting_prompt,
                )
            except Exception as e:
                logger.warning("Greeting LLM failed, using fallback: %s", e)

        if not ai_response:
            ai_response = (
                f"Hi! I'm {agent_name} from {company_name}. "
                f"How may I help you today?"
            )

        memory.append({"role": "assistant", "content": ai_response})

        sentence_idx = 0
        tts = get_tts_service()
        logger.info("WS_GREETING | stage=tts_stream_begin agent=%s voice=%s", agent_name, voice or "auto")
        async for chunk in tts.stream_sentences(ai_response, language=language, voice=voice):
            if chunk.get("audio_data"):
                await websocket.send_json({
                    "type": "sentence",
                    "index": sentence_idx,
                    "text": chunk["text"],
                    "audio_data": chunk["audio_data"],
                })
                sentence_idx += 1

        total_ms = (time.time() - turn_start) * 1000
        await websocket.send_json({
            "type": "turn_done",
            "ai_response": ai_response,
            "debug_info": {
                "total_time_ms": round(total_ms),
                "sentence_count": sentence_idx,
                "agent_name": agent_name,
            },
        })

    except Exception as e:
        logger.error("WS greeting failed: %s", e)
        fallback = (
            f"Hello! I'm {agent_name} from {company_name}. How can I help you today?"
        )
        memory.append({"role": "assistant", "content": fallback})
        try:
            await websocket.send_json({
                "type": "sentence",
                "index": 0,
                "text": fallback,
                "audio_data": None,
            })
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": fallback,
                "debug_info": {},
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Utterance processing: (STT) -> LLM -> TTS, streaming back over WS
# ---------------------------------------------------------------------------

async def _process_turn(
    websocket: WebSocket,
    conversation_id: str,
    mode: str,
    knowledge_file: str,
    language_hint: str,
    memory: list,
    ai_state: dict,
    latency: LatencyTracker,
    duplicates: DuplicateTracker,
    lang_detector: LanguageDetector,
    pcm_bytes: Optional[bytes] = None,
    text_override: Optional[str] = None,
    institute_id: int = 1,
    persona: Optional[dict] = None,
):
    """Process one turn end-to-end and stream sentences back over the WS.

    Either `pcm_bytes` (raw PCM16 mono @16 kHz) or `text_override` (typed
    input that skips STT) must be provided. `persona` carries the agent's
    name/company/instructions/voice so replies speak as THAT agent, and
    RAG retrieval is bound to that agent's isolated FAISS store.
    """
    persona = persona or {}
    agent_name = persona.get("agent_name") or "Aadhya"
    company_name = persona.get("company_name") or "Doneswari"
    agent_voice = persona.get("voice")
    try:
        latency.reset()
        latency.start_turn()

        turn_start = time.time()
        ai_state["speaking"] = True
        await websocket.send_json({"type": "processing"})

        # -- STT (skip when the turn came from typed text) --------------------
        user_text = ""
        detected_lang_code = None
        if text_override is not None:
            user_text = text_override.strip()
            latency.end_stt()
        else:
            latency.start_stt()
            pcm_float = np.frombuffer(bytes(pcm_bytes or b""), dtype=np.int16).astype(np.float32) / 32768.0
            stt_result = await _transcribe_pcm(pcm_float)
            latency.end_stt()
            user_text = (stt_result.get("text") or "").strip()
            detected_lang_code = stt_result.get("language", "en")

        stt_ms = (time.time() - turn_start) * 1000

        if not user_text:
            logger.info("WS STT empty (conv=%s)", conversation_id)
            ai_state["speaking"] = False
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms)},
            })
            return

        # -- Phantom input prevention -----------------------------------------
        last_ai_text = next(
            (m["content"] for m in reversed(memory) if m.get("role") == "assistant"),
            "",
        )

        if _is_noise(user_text):
            logger.info("Phantom input filtered (noise): %s", user_text[:50])
            ai_state["speaking"] = False
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "noise"},
            })
            return

        if _is_backchannel(user_text):
            logger.info("Phantom input filtered (backchannel): %s", user_text[:50])
            ai_state["speaking"] = False
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "backchannel"},
            })
            return

        if _is_echo(user_text, last_ai_text):
            logger.info("Phantom input filtered (echo): %s", user_text[:50])
            ai_state["speaking"] = False
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "echo"},
            })
            return

        should_process, utterance_id = duplicates.should_process(user_text)
        if not should_process:
            ai_state["speaking"] = False
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "duplicate"},
            })
            return

        await websocket.send_json({
            "type": "transcript",
            "text": user_text,
            "language": detected_lang_code or "en",
            "utterance_id": utterance_id,
        })

        detected_lang = lang_detector.detect(user_text, stt_language=detected_lang_code)
        llm_input = transliterate_roman_telugu(user_text)

        # ── PARALLEL: RAG retrieval (fires immediately, does NOT block LLM start) ──
        # We fire RAG as a background task right away so the network round-trip
        # to the embedding model overlaps with the LLM context-building below.
        latency.start_rag()

        async def _rag_task() -> str:
            try:
                if mode == "test":
                    retriever = get_json_retriever(knowledge_file)
                    return retriever.retrieve_context(llm_input, top_k=4) or ""
                else:
                    chunks = await retrieve_context(llm_input, top_k=4, agent_id=institute_id)
                    return format_context_for_prompt(chunks) or ""
            except Exception as e:
                logger.warning("RAG retrieval failed (conv=%s): %s", conversation_id, e)
                return ""

        # Check audio cache BEFORE hitting the LLM at all
        from app.rag.response_cache import get_cached_response, cache_response
        cached_text = await get_cached_response(llm_input, institute_id)

        rag_future = asyncio.create_task(_rag_task())

        # -- LLM streaming + PIPELINED TTS ------------------------------------
        # Architecture:
        #   rag_future  ──────────────────►  context available
        #   LLM stream  starts immediately with "" context, gets updated context
        #               on first real sentence boundary
        #   TTS         fires on FIRST sentence boundary — no waiting for full
        #               LLM completion

        history_list = _build_history(memory)

        sentence_q: asyncio.Queue = asyncio.Queue(maxsize=8)
        ai_parts: list = []
        llm_error: Optional[str] = None

        async def _llm_streamer():
            nonlocal ai_parts, llm_error
            buf = ""
            first_chunk_sent = False
            latency.start_llm()
            try:
                # Wait for RAG with a tight deadline so we don't hold up LLM
                # start for more than 120ms. If RAG takes longer, proceed with
                # empty context and append it on the next turn.
                try:
                    context_text = await asyncio.wait_for(
                        asyncio.shield(rag_future), timeout=0.2
                    )
                except asyncio.TimeoutError:
                    context_text = ""
                    # Let RAG keep running — we'll use its result on the next turn
                latency.end_rag()

                async for delta in stream_chat_fast(
                    llm_input,
                    lang=detected_lang,
                    conversation_history=history_list,
                    context=context_text,
                    agent_name=agent_name,
                    company_name=company_name,
                    instructions=persona.get("instructions"),
                ):
                    if not ai_parts:
                        latency.mark_llm_first_token()
                    buf += delta

                    # First chunk: emit at the first clause boundary (or a
                    # ~40-char word boundary) so TTS synthesis starts on a
                    # SHORT unit — the single biggest TTFA lever.
                    if not first_chunk_sent:
                        m = _FIRST_CLAUSE_BOUNDARY.search(buf)
                        cut = m.end() if m else None
                        if cut is None and len(buf) >= _FIRST_CHUNK_MAX_CHARS:
                            head = buf[:_FIRST_CHUNK_MAX_CHARS]
                            sp = head.rfind(" ")
                            if sp > 10:
                                cut = sp
                        if cut:
                            clause = buf[:cut].strip().rstrip(",")
                            buf = buf[cut:]
                            if clause:
                                first_chunk_sent = True
                                idx = len(ai_parts)
                                ai_parts.append(clause)
                                await sentence_q.put(("sentence", idx, clause))

                    sentences, buf = _pop_complete_sentences(buf)
                    for s in sentences:
                        idx = len(ai_parts)
                        ai_parts.append(s)
                        await sentence_q.put(("sentence", idx, s))
                trailing = buf.strip()
                if trailing:
                    idx = len(ai_parts)
                    ai_parts.append(trailing)
                    await sentence_q.put(("sentence", idx, trailing))
            except Exception as e:
                logger.error("WS LLM streaming failed (conv=%s): %s", conversation_id, e)
                llm_error = str(e)
                await sentence_q.put(("error", llm_error))
            finally:
                latency.end_llm()
                await sentence_q.put(("end", None))

        # If there's a cached audio response, play it instantly (~0ms)
        tts = get_tts_service()
        sentence_count = 0
        first_sentence_text = ""

        if cached_text:
            logger.info("Cache HIT for: %.40s", llm_input)
            ak = _audio_key(llm_input, institute_id)
            cached_audio = _audio_cache_get(ak)
            latency.start_tts()
            if cached_audio:
                # Instant playback: text AND audio were both cached
                latency.mark_tts_first_audio()
                await websocket.send_json({
                    "type": "sentence",
                    "index": 0,
                    "text": cached_text,
                    "audio_data": cached_audio,
                })
                sentence_count = 1
                first_sentence_text = cached_text
            else:
                # Synthesize the cached response (already a finished string)
                async for chunk in tts.stream_sentences(cached_text, language=detected_lang, voice=agent_voice):
                    audio = chunk.get("audio_data")
                    if not audio:
                        continue
                    latency.mark_tts_first_audio()
                    await websocket.send_json({
                        "type": "sentence",
                        "index": sentence_count,
                        "text": chunk["text"],
                        "audio_data": audio,
                    })
                    if sentence_count == 0:
                        first_sentence_text = chunk["text"]
                        _audio_cache_put(ak, audio)
                    sentence_count += 1
            latency.end_tts()
            ai_response = cached_text
            # Cancel the still-pending RAG future
            rag_future.cancel()
        else:
            # Full pipeline: LLM → per-sentence TTS (pipelined, not sequential)
            llm_task = asyncio.create_task(_llm_streamer())

            # TTS pending queue — synthesize each sentence as soon as it arrives
            # from LLM so audio is ready the moment the previous sentence finishes.
            tts_tasks: list = []

            try:
                latency.start_tts()
                while True:
                    kind = await sentence_q.get()
                    if kind[0] in ("end", "error"):
                        if kind[0] == "error":
                            llm_error = kind[1]
                        break

                    _idx, payload = kind[1], kind[2]
                    if not payload or not payload.strip():
                        continue

                    # Synthesize this sentence immediately (do NOT await — it
                    # runs concurrently with the LLM still streaming later sentences)
                    async for chunk in tts.stream_sentences(payload, language=detected_lang, voice=agent_voice):
                        audio = chunk.get("audio_data")
                        if not audio:
                            continue
                        latency.mark_tts_first_audio()
                        await websocket.send_json({
                            "type": "sentence",
                            "index": sentence_count,
                            "text": chunk["text"],
                            "audio_data": audio,
                        })
                        if sentence_count == 0 and not first_sentence_text:
                            first_sentence_text = chunk["text"]
                            # Cache the first-sentence audio for instant repeat playback
                            _audio_cache_put(_audio_key(llm_input, institute_id), audio)
                        sentence_count += 1
            finally:
                if not llm_task.done():
                    llm_task.cancel()
                try:
                    await llm_task
                except asyncio.CancelledError:
                    pass
                latency.end_tts()

            ai_response = " ".join(p.strip() for p in ai_parts if p.strip())

            # Cache the response for next time
            if ai_response and len(ai_response) < 400:
                asyncio.create_task(cache_response(llm_input, institute_id, ai_response))

        if not cached_text:
            ai_response = " ".join(p.strip() for p in ai_parts if p.strip())

        # Graceful spoken fallback so the call never goes silent.
        if not ai_response:
            if llm_error:
                logger.error("WS LLM error (conv=%s): %s", conversation_id, llm_error)
            ai_response = (
                "Sorry, I didn't catch that properly — could you say it again?"
                if detected_lang == "English"
                else "క్షమించండి, నాకు సరిగ్గా అర్థం కాలేదు — మళ్లీ చెబుతారా?"
                if detected_lang == "Telugu"
                else "Sorry, could you say that again?"
            )
            async for chunk in tts.stream_sentences(ai_response, language=detected_lang, voice=agent_voice):
                if chunk.get("audio_data"):
                    await websocket.send_json({
                        "type": "sentence",
                        "index": sentence_count,
                        "text": chunk["text"],
                        "audio_data": chunk["audio_data"],
                    })
                    sentence_count += 1

        memory.append({"role": "user", "content": user_text})
        memory.append({"role": "assistant", "content": ai_response})
        if len(memory) > 40:
            del memory[:len(memory) - 40]
        ai_state["last_response"] = ai_response
        ai_state["speaking"] = False
        ai_state["finished_at"] = time.time()

        metrics = latency.get_metrics()
        metrics["sentence_count"] = sentence_count
        metrics["first_sentence_text"] = first_sentence_text[:120]
        metrics["llm_error"] = llm_error
        metrics["detected_language"] = detected_lang
        logger.info(
            "WS_TURN | conv=%s | lang=%s | stt=%.0fms | rag=%.0fms | "
            "llm_ttft=%.0fms | llm_total=%.0fms | tts_first=%.0fms | "
            "ttfa=%.0fms | total=%.0fms | sentences=%d%s",
            conversation_id,
            detected_lang,
            metrics.get("stt_ms", 0),
            metrics.get("rag_ms", 0),
            metrics.get("llm_ttft_ms", 0),
            metrics.get("llm_total_ms", 0),
            metrics.get("tts_first_audio_ms", 0),
            metrics.get("ttfa_ms", 0),
            metrics.get("total_turn_ms", 0),
            sentence_count,
            f" ERROR={llm_error[:80]}" if llm_error else "",
        )

        await websocket.send_json({
            "type": "turn_done",
            "ai_response": ai_response,
            "debug_info": metrics,
        })

    except Exception as e:
        logger.exception("WS turn processing failed (conv=%s): %s", conversation_id, e)
        try:
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"error": str(e)},
            })
        except Exception:
            pass
        finally:
            ai_state["speaking"] = False


# ---------------------------------------------------------------------------
# WebSocket voice agent endpoint
# ---------------------------------------------------------------------------

@router.websocket("/ws/voice/{agent_id}")
async def ws_voice_agent(websocket: WebSocket, agent_id: str = "web"):
    """Real-time bidirectional voice WebSocket for a published agent."""
    await websocket.accept()
    logger.info("WS voice connect: agent=%s client=%s", agent_id, websocket.client)

    connected_at = time.time()
    conversation_id = uuid.uuid4().hex[:12]
    mode = "test"
    knowledge_file = "institute.json"
    institute_id = 1
    language = "English"
    memory: list = []  # [{role, content}]

    # -- Hello handshake (tolerant: missing hello still works with defaults) --
    try:
        first = await asyncio.wait_for(websocket.receive(), timeout=10.0)
        if first.get("type") == "websocket.disconnect":
            return
        hello = {}
        if first.get("text"):
            try:
                hello = json.loads(first["text"])
            except Exception:
                hello = {}
        if isinstance(hello, dict):
            mode = str(hello.get("mode") or mode).lower()
            knowledge_file = str(hello.get("knowledge_file") or knowledge_file)
            try:
                institute_id = int(hello.get("institute_id") or 1)
            except (TypeError, ValueError):
                institute_id = 1
            language = str(hello.get("language") or language)
            conversation_id = str(hello.get("conversation_id") or conversation_id)
            mem = hello.get("memory") or []
            if isinstance(mem, str):
                try:
                    mem = json.loads(mem)
                except Exception:
                    mem = []
            if isinstance(mem, list):
                for m in mem:
                    if isinstance(m, dict) and m.get("content"):
                        memory.append({
                            "role": m.get("role") or "assistant",
                            "content": str(m["content"]),
                        })
                    elif isinstance(m, str) and m.strip():
                        memory.append({"role": "assistant", "content": m})
    except asyncio.TimeoutError:
        pass  # no hello — proceed with defaults
    except Exception as e:
        logger.warning("WS hello failed: %s", e)

    await websocket.send_json({
        "type": "connected",
        "conversation_id": conversation_id,
    })

    ai_state: dict = {"speaking": False, "finished_at": 0.0, "last_response": ""}
    latency = LatencyTracker()
    duplicates = DuplicateTracker()
    lang_detector = LanguageDetector()
    turn_detector = TurnDetector()

    # -- Resolve the agent persona from the DB (name, company, voice, ...) -----
    persona: dict = {
        "agent_name": "Aadhya",
        "company_name": "Doneswari",
        "greeting_message": None,
        "instructions": None,
        "voice": None,
    }
    try:
        db_agent_id = int(agent_id) if str(agent_id).isdigit() else institute_id
        from app.database.connection import AsyncSessionLocal
        from app.database.models import Institute
        async with AsyncSessionLocal() as session:
            agent_row = await session.get(Institute, db_agent_id)
            if agent_row:
                institute_id = agent_row.id
                persona = {
                    "agent_name": agent_row.agent_name or agent_row.name or "Aadhya",
                    "company_name": agent_row.name or "Doneswari",
                    "greeting_message": agent_row.greeting_message,
                    "instructions": agent_row.instructions,
                    "voice": agent_row.voice or None,
                }
                logger.info(
                    "WS persona resolved: agent=%s company=%s voice=%s",
                    persona["agent_name"], persona["company_name"], persona["voice"],
                )
            else:
                logger.warning("WS agent %s not found; using default persona", agent_id)
    except Exception as e:
        logger.warning("WS persona resolution failed: %s", e)

    # -- Greeting --------------------------------------------------------------
    try:
        await _send_greeting(
            websocket, mode, knowledge_file, institute_id, language, memory,
            persona=persona,
        )
    except Exception as e:
        logger.error("WS greeting send failed: %s", e)

    # -- Worker: process queued utterances sequentially ------------------------
    utterance_q: asyncio.Queue = asyncio.Queue()

    async def _worker():
        while True:
            kind, payload = await utterance_q.get()
            try:
                if kind == "text":
                    await _process_turn(
                        websocket, conversation_id, mode, knowledge_file,
                        language, memory, ai_state, latency, duplicates,
                        lang_detector, text_override=payload,
                        institute_id=institute_id, persona=persona,
                    )
                else:
                    await _process_turn(
                        websocket, conversation_id, mode, knowledge_file,
                        language, memory, ai_state, latency, duplicates,
                        lang_detector, pcm_bytes=payload,
                        institute_id=institute_id, persona=persona,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("WS worker error (conv=%s): %s", conversation_id, e)
            finally:
                utterance_q.task_done()

    worker_task = asyncio.create_task(_worker())

    # -- Receive loop: VAD + control messages ----------------------------------
    pcm_buffer = bytearray()
    speech_started = False
    utterance_frames = 0
    max_utterance_frames = int(MAX_UTTERANCE_SECONDS * 1000 / FRAME_MS)

    async def _flush_utterance():
        """Cut the current utterance and queue it for processing."""
        nonlocal pcm_buffer, speech_started, utterance_frames
        turn_detector.reset()
        if len(pcm_buffer) >= int(MIN_UTTERANCE_MS / FRAME_MS) * FRAME_SAMPLES * 2:
            pcm_copy = bytes(pcm_buffer)
            await utterance_q.put(("audio", pcm_copy))
        pcm_buffer.clear()
        speech_started = False
        utterance_frames = 0

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            # -- JSON control / typed text ------------------------------------
            if (raw_text := msg.get("text")) is not None:
                try:
                    data = json.loads(raw_text)
                except Exception:
                    continue
                mtype = data.get("type")
                if mtype == "end":
                    break
                if mtype == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue
                if mtype == "text":
                    text = str(data.get("text") or "").strip()
                    if text:
                        await utterance_q.put(("text", text))
                continue

            # -- Binary PCM frame: VAD -----------------------------------------
            frame = msg.get("bytes")
            if not frame or len(frame) < 4:
                continue

            try:
                pcm_int16 = np.frombuffer(frame, dtype=np.int16)
                pcm_float = pcm_int16.astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(pcm_float ** 2)))
            except Exception:
                continue

            is_speech = rms > ENERGY_THRESHOLD

            # Barge-in: caller is talking while Mrs. D speaks → tell the client
            # to stop playback so the caller can take the floor immediately.
            if is_speech and ai_state.get("speaking"):
                await websocket.send_json({"type": "speech_start"})

            if is_speech:
                if not speech_started:
                    speech_started = True
                pcm_buffer.extend(frame)
                utterance_frames += 1
                turn_detector.update(True)
                # Hard cap: process very long monologues in chunks
                if utterance_frames >= max_utterance_frames:
                    await _flush_utterance()
            elif speech_started:
                # Include trailing silence in the buffer (natural cut)
                pcm_buffer.extend(frame)
                utterance_frames += 1
                if turn_detector.update(False):
                    await _flush_utterance()

    except WebSocketDisconnect:
        logger.info("WS voice disconnect: agent=%s conv=%s", agent_id, conversation_id)
    except Exception as e:
        logger.exception("WS voice loop error: agent=%s conv=%s: %s", agent_id, conversation_id, e)
    finally:
        worker_task.cancel()
        try:
            await worker_task
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        # Generate + persist the structured call report at WS disconnect (spec §32).
        try:
            await _finalize_ws_call(
                conversation_id=conversation_id,
                mode=mode,
                institute_id=institute_id,
                knowledge_file=knowledge_file,
                memory=memory,
                ai_state=ai_state,
                duration_seconds=int(time.time() - connected_at),
            )
        except Exception as e:
            logger.error("WS call finalization failed (conv=%s): %s", conversation_id, e)


# ---------------------------------------------------------------------------
# Call-end finalization: persist the structured call report (spec §32)
# ---------------------------------------------------------------------------

async def _finalize_ws_call(
    conversation_id: str,
    mode: str,
    institute_id: int,
    knowledge_file: str,
    memory: list,
    ai_state: dict,
    duration_seconds: int = 0,
) -> None:
    """Create/complete the CallHistory row and persist a CallReport at
    disconnect (spec §32).

    Web voice calls may not have a CallHistory row yet — one is created so
    Calls & Leads shows real lead info. Best-effort: any DB failure is logged,
    never raised.
    """
    from sqlalchemy import select
    from app.database.connection import AsyncSessionLocal
    from app.database.models import (
        CallHistory, CallReport, Institute, CallStatus, Sentiment,
    )

    # Build the full transcript from memory.
    transcript_parts: list = []
    for m in memory:
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        role = "user" if m.get("role") == "user" else "assistant"
        transcript_parts.append(f"[{role}] {content}")
    transcript = "\n".join(transcript_parts)

    if not transcript.strip():
        logger.info("WS_FINALIZE | conv=%s | empty transcript; skipping", conversation_id)
        return

    memory_dict: dict = {k: "" for k in (
        "Name", "Student Name", "Class", "Course", "Location",
        "Budget", "Hostel", "Transport", "Interest", "Objections",
        "Preferred callback",
    )}

    try:
        async with AsyncSessionLocal() as session:
            # The institute must exist for the FK to hold.
            inst_result = await session.execute(
                select(Institute).where(Institute.id == institute_id)
            )
            institute = inst_result.scalar_one_or_none()
            if not institute:
                logger.info(
                    "WS_FINALIZE | institute %s not found; skipping report (conv=%s)",
                    institute_id, conversation_id,
                )
                return

            now = datetime.now(timezone.utc)
            result = await session.execute(
                select(CallHistory).where(CallHistory.call_id == conversation_id)
            )
            call = result.scalar_one_or_none()
            if not call:
                call = CallHistory(
                    call_id=conversation_id,
                    institute_id=institute_id,
                    caller_number="web-client",
                    call_status=CallStatus.COMPLETED,
                    started_at=now,
                    answered_at=now,
                    ended_at=now,
                    duration_seconds=duration_seconds,
                    transcript=transcript,
                    total_turns=len(memory),
                )
                session.add(call)
                await session.flush()
                logger.info("WS_FINALIZE | created CallHistory conv=%s", conversation_id)
            else:
                call.transcript = transcript
                call.ended_at = now
                call.duration_seconds = duration_seconds
                call.call_status = CallStatus.COMPLETED
                call.total_turns = len(memory)

            data = generate_report_data(
                call_id=conversation_id,
                institute_id=institute_id,
                institute_name=institute.name,
                transcript=transcript,
                memory=memory_dict,
                detected_language=call.detected_language,
                sentiment=call.sentiment or Sentiment.UNKNOWN,
                duration_seconds=duration_seconds,
            )

            existing = await session.execute(
                select(CallReport).where(CallReport.call_id == conversation_id)
            )
            report = existing.scalar_one_or_none()
            if report:
                for key, value in data.items():
                    setattr(report, key, value)
            else:
                report = CallReport(**data)
                session.add(report)

            await session.commit()
            logger.info(
                "WS_FINALIZE | conv=%s | interest=%d%% | conversion=%d%% | "
                "intent=%s | next=%s",
                conversation_id,
                data.get("interest_score", 0),
                data.get("conversion_probability", 0),
                data.get("intent", "?"),
                data.get("next_action", "?"),
            )
    except Exception as e:
        logger.error("WS_FINALIZE | failed for conv=%s: %s", conversation_id, e)
