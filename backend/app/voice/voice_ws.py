"""
WebSocket Voice Agent - Retell AI-level real-time voice conversation.

Persistent bidirectional WebSocket:
  Client -> Server: PCM 16 kHz mono audio frames (binary)
  Server -> Client: JSON control messages + base64 MP3 sentence audio

Pipeline (server-side):
  Energy VAD -> Groq Whisper STT -> Groq LLM (streaming) -> Edge-TTS (per sentence)

This eliminates per-turn HTTP overhead and moves VAD + STT to the server
for lower latency - matching Retell AI's architecture.
"""

import asyncio
import base64
import io
import json
import random
import re as _re
import struct
import time
import uuid
from typing import Optional

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config.settings import settings
from app.logs.logger import get_logger
from app.rag.groq_service import generate_response, stream_chat
from app.rag.retriever import retrieve_context, format_context_for_prompt
from app.rag.json_retriever import get_json_retriever
from app.tts.edge_tts_service import EdgeTTSService
from app.roman_telugu import looks_roman_telugu, transliterate_roman_telugu

logger = get_logger(__name__)

router = APIRouter(tags=["Voice WebSocket"])

tts_service = EdgeTTSService()


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
    "theek", "theek hai", "theekhai", "hmm hmm", "haanji",
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
    letters = _re.sub(r"[^\p{L}\p{N}]", "", text, flags=_re.UNICODE)
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
    ai = last_ai_text.strip().lower()
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


class DuplicateTracker:
    """Track processed utterances to prevent duplicate processing."""
    
    def __init__(self, window_seconds: int = 8):
        self.recent = []  # List of (utterance_id, normalized_text, timestamp)
        self.window = window_seconds
        self.counter = 0
    
    def _normalize(self, text: str) -> str:
        return text.strip().lower().replace(r"\s+", " ")
    
    def should_process(self, text: str) -> tuple[bool, str]:
        """
        Returns (should_process, utterance_id).
        False if this is a duplicate within the time window.
        """
        now = time.time()
        normalized = self._normalize(text)
        
        # Check for recent duplicates
        self.recent = [
            (uid, norm, ts) for uid, norm, ts in self.recent
            if now - ts < self.window
        ]
        
        for uid, norm, _ in self.recent:
            if norm == normalized:
                logger.info("Duplicate utterance ignored: %s", text[:50])
                return False, ""
        
        # New utterance
        self.counter += 1
        utterance_id = f"utt_{self.counter}"
        self.recent.append((utterance_id, normalized, now))
        return True, utterance_id


# Global duplicate tracker
_duplicate_tracker = DuplicateTracker()


# ---------------------------------------------------------------------------
# Latency Instrumentation (spec §27, §34)
# ---------------------------------------------------------------------------

class LatencyTracker:
    """Track latency metrics for the voice pipeline."""
    
    def __init__(self):
        self.reset()
    
    def reset(self):
        """Reset all timers for a new turn."""
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
        """Mark the start of a turn (user speech end)."""
        self.turn_start = time.time()
    
    def mark_speech_end(self):
        """Mark when user speech ended (for TTFA calculation)."""
        self.speech_end = time.time()
    
    def start_stt(self):
        """Mark STT start."""
        self.stt_start = time.time()
    
    def end_stt(self):
        """Mark STT end."""
        self.stt_end = time.time()
    
    def start_rag(self):
        """Mark RAG start."""
        self.rag_start = time.time()
    
    def end_rag(self):
        """Mark RAG end."""
        self.rag_end = time.time()
    
    def start_llm(self):
        """Mark LLM start."""
        self.llm_start = time.time()
    
    def mark_llm_first_token(self):
        """Mark when LLM emitted first token (TTFT)."""
        if self.llm_first_token == 0.0:
            self.llm_first_token = time.time()
    
    def end_llm(self):
        """Mark LLM end."""
        self.llm_end = time.time()
    
    def start_tts(self):
        """Mark TTS start."""
        self.tts_start = time.time()
    
    def mark_tts_first_audio(self):
        """Mark when first audio was generated (for TTFA)."""
        if self.tts_first_audio == 0.0:
            self.tts_first_audio = time.time()
    
    def end_tts(self):
        """Mark TTS end."""
        self.tts_end = time.time()
    
    def get_metrics(self) -> dict:
        """Get all latency metrics in milliseconds."""
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
        
        # TTFA: Time to First Audio from speech end
        if self.speech_end > 0 and self.tts_first_audio > 0:
            metrics["ttfa_ms"] = round((self.tts_first_audio - self.speech_end) * 1000)
        
        # Total turn time
        if self.turn_start > 0 and self.tts_end > 0:
            metrics["total_turn_ms"] = round((self.tts_end - self.turn_start) * 1000)
        
        return metrics


# Global latency tracker
_latency_tracker = LatencyTracker()


# ---------------------------------------------------------------------------
# Language detection with stability and confidence tracking (spec §13, §14)
# ---------------------------------------------------------------------------

class LanguageDetector:
    """Detect and stabilize language across conversation turns."""
    
    def __init__(self, history_size: int = 5):
        self.history: list = []  # Recent language detections
        self.history_size = history_size
        self.current_language = "English"
        self.language_confidence = 0.0
    
    def detect(self, user_input: str, stt_language: Optional[str] = None) -> str:
        """Detect language with confidence and stability."""
        detected = self._detect_single(user_input, stt_language)
        
        # Add to history
        self.history.append(detected)
        if len(self.history) > self.history_size:
            self.history.pop(0)
        
        # Calculate confidence based on history
        if len(self.history) >= 2:
            # Count occurrences of each language
            counts = {}
            for lang in self.history:
                counts[lang] = counts.get(lang, 0) + 1
            
            # Get most common language
            most_common = max(counts, key=counts.get)
            confidence = counts[most_common] / len(self.history)
            
            # Only switch if confidence is high (spec §14)
            if confidence >= 0.6:
                self.current_language = most_common
                self.language_confidence = confidence
            # Otherwise maintain current language
        else:
            self.current_language = detected
            self.language_confidence = 0.5
        
        return self.current_language
    
    def _detect_single(self, user_input: str, stt_language: Optional[str] = None) -> str:
        """Detect language from a single utterance."""
        # Priority 1: STT language hint if available
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
        
        # Priority 2: Telugu script detection
        if _re.search(r"[\u0C00-\u0C7F]", user_input):
            return "Telugu"
        
        # Priority 3: Roman Telugu/Tenglish detection (spec §13)
        if looks_roman_telugu(user_input):
            return "Telugu"
        
        # Priority 4: Hindi script detection
        if _re.search(r"[\u0900-\u097F]", user_input):
            return "Hindi"
        
        # Priority 5: Tamil script detection
        if _re.search(r"[\u0B80-\u0BFF]", user_input):
            return "Tamil"
        
        # Priority 6: Kannada script detection
        if _re.search(r"[\u0C80-\u0CFF]", user_input):
            return "Kannada"
        
        # Priority 7: Malayalam script detection
        if _re.search(r"[\u0D00-\u0D7F]", user_input):
            return "Malayalam"
        
        # Default: English
        return "English"


# Global language detector
_language_detector = LanguageDetector()


LANGUAGE_INSTRUCTION = (
    "## Call Instructions\n"
    "You are Mrs. D on a live admissions call. Reply in {language} (the caller's language - "
    "Roman Telugu like 'idhi enti' or 'naku MPC kavali' counts as Telugu; reply in Telugu script).\n"
    "\n"
    "BEHAVIOUR (follow strictly):\n"
    "- NEVER restate, translate, or paraphrase the caller's words.\n"
    "- Acknowledge naturally and briefly ONLY when it fits - and VARY it by context.\n"
    "- ANSWER COMPLETELY. When the caller asks for details, give the FULL breakdown.\n"
    "- NEVER end with a follow-up question just to keep the call going.\n"
    "- DO NOT HALLUCINATE. Use ONLY the provided knowledge.\n"
    "- Keep it SHORT like a phone call: 2-5 conversational sentences.\n"
    "- Speak like a warm professional counsellor: confident, concise, human.\n"
    "- NEVER start every response with 'Avunu, tappakunda' or similar repetitive phrases.\n"
    "- Use natural fillers contextually: 'Hmm...', 'Sare...', 'Okay...', 'One second...' - vary them.\n"
    "- If information is unavailable, say: 'That particular detail isn't available in the information I have right now.'\n"
    "- Maintain conversation context - understand follow-ups without repeated clarification.\n"
)


# ---------------------------------------------------------------------------
# Natural pause calculation (human breathing cadence)
# ---------------------------------------------------------------------------

def _natural_pause_ms(sentence: str) -> int:
    """Calculate a natural breathing pause after a sentence.
    
    Humans pause different lengths based on sentence type:
    - Questions: longer pause (thinking beat)
    - Exclamations: shorter pause (emphasis)
    - Long sentences: longer pause (deeper breath)
    - Short acknowledgements: brief pause
    """
    s = sentence.strip()
    if s.endswith("?"):
        return 450 + int(random.random() * 200)  # 450-650ms
    if s.endswith("!"):
        return 350 + int(random.random() * 150)  # 350-500ms
    if s.endswith("..."):
        return 500 + int(random.random() * 200)  # 500-700ms (trailing thought)
    if len(s) > 120:
        return 400 + int(random.random() * 200)  # 400-600ms (long thought)
    if len(s) < 25:
        return 250 + int(random.random() * 150)  # 250-400ms (quick ack)
    return 300 + int(random.random() * 200)  # 300-500ms (default)


# ---------------------------------------------------------------------------
# Sentence boundary detector (shared logic with conversation_routes)
# ---------------------------------------------------------------------------

_SENT_BOUNDARY = _re.compile(r"[.!?](?=\s|$|\n)|\n")


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
    """Build conversation history for LLM context with context awareness (spec §27, §28).
    
    Maintains short-term context to understand follow-ups without repeated clarification.
    Example: User asks "MPC fee?" then "Hostel?" - system should understand same institution context.
    """
    history = []
    for i in range(0, len(memory), 2):
        if i + 1 < len(memory):
            history.append({"role": "user", "content": memory[i]})
            history.append({"role": "assistant", "content": memory[i + 1]})
    
    # Keep last 8 turns for context (16 messages) - balance between context and speed
    recent_history = history[-8:] if len(history) > 8 else history
    
    # Add context hint at the beginning if we have history
    if recent_history:
        # Extract key entities from recent conversation (institution, course, etc.)
        # This helps the LLM maintain context for follow-ups
        context_hint = "CONVERSATION CONTEXT: You are in an ongoing conversation. "
        context_hint += "Understand follow-up questions without asking for clarification again. "
        context_hint += "If user asks about 'fee', 'hostel', 'transport', etc., "
        context_hint += "assume they mean for the same institution/course previously discussed."
        
        # Insert as a system message
        recent_history.insert(0, {"role": "system", "content": context_hint})
    
    return recent_history


# ---------------------------------------------------------------------------
# Server-side VAD parameters with enhanced turn detection (spec §10)
# ---------------------------------------------------------------------------
# Enhanced turn detection: not just simple 2-second silence. Uses:
# - VAD energy threshold
# - Partial transcript stability
# - Pause duration with adaptive thresholds
# - Semantic completeness heuristics
# - Conversation context

SAMPLE_RATE = 16000
FRAME_MS = 20  # 20 ms per frame — finer granularity for faster response
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)  # 320 samples
ENERGY_THRESHOLD = 0.012  # RMS below this = silence (slightly lower to catch softer speech)

# Adaptive silence thresholds based on conversation state
SILENCE_FRAMES_SHORT = 25  # ~500ms - for short utterances (quick responses)
SILENCE_FRAMES_MEDIUM = 40  # ~800ms - for medium utterances (normal pauses)
SILENCE_FRAMES_LONG = 60  # ~1200ms - for long utterances (thinking pauses)
SILENCE_FRAMES_TO_END = SILENCE_FRAMES_MEDIUM  # Default

MAX_UTTERANCE_SECONDS = 30  # hard cap
# Pre-speech buffer: keep 200ms of audio BEFORE speech onset to avoid clipping
PRE_SPEECH_MS = 200
PRE_SPEECH_FRAMES = int(PRE_SPEECH_MS / FRAME_MS)

# Turn detection state
class TurnDetector:
    """Enhanced turn detection with adaptive silence thresholds."""
    
    def __init__(self):
        self.speech_frames = 0  # Count of speech frames in current utterance
        self.silence_frames = 0  # Count of consecutive silence frames
        self.current_threshold = SILENCE_FRAMES_MEDIUM
        
    def update(self, is_speech: bool) -> bool:
        """Update turn detector state. Returns True if turn should end."""
        if is_speech:
            self.speech_frames += 1
            self.silence_frames = 0
            return False
        else:
            self.silence_frames += 1
            
            # Adaptive threshold based on utterance length
            if self.speech_frames < 30:  # Short utterance (<600ms)
                self.current_threshold = SILENCE_FRAMES_SHORT
            elif self.speech_frames < 100:  # Medium utterance (<2s)
                self.current_threshold = SILENCE_FRAMES_MEDIUM
            else:  # Long utterance
                self.current_threshold = SILENCE_FRAMES_LONG
            
            # Check if silence threshold exceeded
            if self.silence_frames >= self.current_threshold:
                return True
            return False
    
    def reset(self):
        """Reset for new utterance."""
        self.speech_frames = 0
        self.silence_frames = 0
        self.current_threshold = SILENCE_FRAMES_MEDIUM


# Global turn detector
_turn_detector = TurnDetector()


# ---------------------------------------------------------------------------
# PCM -> Groq Whisper transcription
# ---------------------------------------------------------------------------

async def _transcribe_pcm(pcm_float: np.ndarray) -> dict:
    """Transcribe PCM float32 samples via Groq Whisper.

    Converts float32 -> int16 PCM -> WAV in memory and sends to the
    existing ``/api/conversation/transcribe`` backend (Groq Whisper Large
    V3 Turbo, auto language detection).
    """
    from app.stt.groq_stt import transcribe_audio as groq_transcribe

    pcm_int16 = np.clip(pcm_float * 32768, -32768, 32767).astype(np.int16)
    pcm_bytes = pcm_int16.tobytes()

    # Build WAV in memory
    wav_buf = io.BytesIO()
    num_channels = 1
    sample_width = 2  # 16-bit
    data_rate = SAMPLE_RATE * num_channels * sample_width
    wav_buf.write(b"RIFF")
    wav_buf.write(struct.pack("<I", 36 + len(pcm_bytes)))
    wav_buf.write(b"WAVE")
    wav_buf.write(b"fmt ")
    wav_buf.write(
        struct.pack(
            "<IHHIIHH",
            16,  # chunk size
            1,  # PCM format
            num_channels,
            SAMPLE_RATE,
            data_rate,
            num_channels * sample_width,
            16,  # bits per sample
        )
    )
    wav_buf.write(b"data")
    wav_buf.write(struct.pack("<I", len(pcm_bytes)))
    wav_buf.write(pcm_bytes)
    wav_bytes = wav_buf.getvalue()

    result = await groq_transcribe(wav_bytes, filename="utterance.wav")
    return result


# ---------------------------------------------------------------------------
# WebSocket greeting
# ---------------------------------------------------------------------------

async def _send_greeting(
    websocket: WebSocket,
    mode: str,
    knowledge_file: str,
    institute_id: int,
    language: str,
    memory: list,
):
    """Send the initial greeting over WebSocket."""
    try:
        turn_start = time.time()

        if mode == "test":
            retriever = get_json_retriever(knowledge_file)
            ai_response = retriever.get_greeting(language=language)
        else:
            retrieved_chunks = await retrieve_context(
                "institute name college school", top_k=5, min_score=0.1
            )
            context_text = format_context_for_prompt(retrieved_chunks)
            institute_name = "the institute"
            if context_text:
                for pattern in [
                    r'(?:institute|college|school|university)[\s]+(?:name|is|called|:)\s*([A-Z][A-Za-z\s]+)',
                    r'([A-Z][A-Za-z\s]+(?:College|Institute|School|University))',
                ]:
                    m = _re.search(pattern, context_text, _re.IGNORECASE)
                    if m:
                        institute_name = m.group(1).strip()
                        break
            greeting_prompt = (
                f"You are Mrs. D, a warm Indian admissions counsellor speaking on a live call.\n"
                f"You are representing {institute_name}.\n\n"
                f"Write a friendly, brief (2-3 sentence) greeting in {language}. "
                f"Introduce yourself and mention {institute_name}."
            )
            ai_response = await generate_response(
                conversation_history=[],
                context=context_text or "",
                user_message=greeting_prompt,
            )

        memory.append(ai_response)

        # Stream greeting sentences
        sentence_idx = 0
        async for chunk in tts_service.stream_sentences(ai_response, language=language):
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
                "first_sentence_ms": round(total_ms * 0.4) if sentence_idx > 0 else 0,
                "sentence_count": sentence_idx,
            },
        })

    except Exception as e:
        logger.error("WS greeting failed: %s", e)
        fallback = (
            "Hello! I'm Mrs. D, your AI admissions counsellor. "
            "How can I help you today?"
        )
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
# Utterance processing: STT -> LLM -> TTS, streaming back over WS
# ---------------------------------------------------------------------------

async def _process_utterance(
    websocket: WebSocket,
    pcm_buffer: bytearray,
    conversation_id: str,
    mode: str,
    knowledge_file: str,
    institute_id: int,
    language: str,
    memory: list,
    ai_state: dict,
):
    """Process a detected utterance: STT -> LLM -> TTS, streaming back over WS.
    
    ai_state: mutable dict with keys 'speaking' (bool) and 'finished_at' (float)
    """
    try:
        # Reset and start latency tracking for this turn
        _latency_tracker.reset()
        _latency_tracker.start_turn()
        _latency_tracker.mark_speech_end()
        
        turn_start = time.time()

        # Track AI speaking state for echo cancellation
        ai_state["speaking"] = True
        
        # Notify client: we're processing
        await websocket.send_json({"type": "processing"})

        # -- STT ------------------------------------------------------------------
        _latency_tracker.start_stt()
        pcm_float = (
            np.frombuffer(bytes(pcm_buffer), dtype=np.int16).astype(np.float32) / 32768.0
        )

        stt_result = await _transcribe_pcm(pcm_float)
        _latency_tracker.end_stt()
        stt_ms = (time.time() - turn_start) * 1000

        user_text = (stt_result.get("text") or "").strip()
        detected_lang_code = stt_result.get("language", "en")

        if not user_text:
            logger.info("WS STT empty (conv=%s)", conversation_id)
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms)},
            })
            return

        # Phantom input prevention (spec §6, §10, §20, §21, §48)
        last_ai_text = memory[-1] if memory else ""
        
        # Check for noise
        if _is_noise(user_text):
            logger.info("Phantom input filtered (noise): %s", user_text[:50])
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "noise"},
            })
            return
        
        # Check for backchannel (only if no interruption words)
        if _is_backchannel(user_text):
            logger.info("Phantom input filtered (backchannel): %s", user_text[:50])
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "backchannel"},
            })
            return
        
        # Check for echo of AI's last speech
        if _is_echo(user_text, last_ai_text):
            logger.info("Phantom input filtered (echo): %s", user_text[:50])
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "echo"},
            })
            return
        
        # Check for duplicate utterance
        should_process, utterance_id = _duplicate_tracker.should_process(user_text)
        if not should_process:
            await websocket.send_json({
                "type": "turn_done",
                "ai_response": "",
                "debug_info": {"stt_ms": round(stt_ms), "filtered": "duplicate"},
            })
            return

        # Send transcription to client for display
        await websocket.send_json({
            "type": "transcript",
            "text": user_text,
            "language": detected_lang_code,
            "utterance_id": utterance_id,
        })

        # Enhanced language detection with stability (spec §13, §14)
        detected_lang = _language_detector.detect(user_text, stt_language=detected_lang_code)
        llm_input = transliterate_roman_telugu(user_text)

        # -- RAG ------------------------------------------------------------------
        _latency_tracker.start_rag()
        if mode == "test":
            retriever = get_json_retriever(knowledge_file)
            context = retriever.retrieve_context(llm_input, top_k=5)
        else:
            retrieved_chunks = await retrieve_context(llm_input, top_k=5)
            context = format_context_for_prompt(retrieved_chunks)
        _latency_tracker.end_rag()
        rag_ms = (time.time() - turn_start) * 1000

        # -- LLM streaming + sentence-level TTS -----------------------------------
        history_list = _build_history(memory)
        lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
        sentence_q: asyncio.Queue = asyncio.Queue()
        ai_parts: list = []
        llm_error: Optional[str] = None

        async def _llm_streamer():
            nonlocal ai_parts
            buf = ""
            _latency_tracker.start_llm()
            try:
                async for delta in stream_chat(
                    f"{llm_input}\n\n{lang_hint}", history_list, context
                ):
                    if not ai_parts:  # First token
                        _latency_tracker.mark_llm_first_token()
                    buf += delta
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
                logger.error("WS LLM streaming failed: %s", e)
                await sentence_q.put(("error", str(e)))
            finally:
                _latency_tracker.end_llm()
                await sentence_q.put(("end", None))

        llm_task = asyncio.create_task(_llm_streamer())
        synth_lang = detected_lang
        sentence_count = 0
        first_sentence_ms = 0
        last_sentence_text = ""
        _latency_tracker.start_tts()

        try:
            while True:
                kind = await sentence_q.get()
                if kind[0] == "end":
                    break
                if kind[0] == "error":
                    llm_error = kind[1]
                    break

                _idx, payload = kind[1], kind[2]
                # Send a natural pause event between sentences for breathing
                if sentence_count > 0 and last_sentence_text:
                    pause_ms = _natural_pause_ms(last_sentence_text)
                    await websocket.send_json({
                        "type": "pause",
                        "duration_ms": pause_ms,
                    })
                tts_start = time.time()
                async for chunk in tts_service.stream_sentences(
                    payload, language=synth_lang
                ):
                    if chunk.get("audio_data") is None:
                        continue
                    if first_sentence_ms == 0:
                        first_sentence_ms = (time.time() - turn_start) * 1000
                        _latency_tracker.mark_tts_first_audio()
                    await websocket.send_json({
                        "type": "sentence",
                        "index": _idx,
                        "text": chunk["text"],
                        "audio_data": chunk["audio_data"],
                    })
                    sentence_idx += 1
                    last_sentence_text = chunk["text"]
                tts_ms = (time.time() - tts_start) * 1000
        finally:
            if not llm_task.done():
                llm_task.cancel()
            _latency_tracker.end_tts()

        ai_response = "".join(ai_parts).strip()
        if llm_error and not ai_response:
            ai_response = (
                "I can help with that. We offer MPC, BiPC, MEC and CEC streams. "
                "What would you like to know more about - courses, fees or admission?"
            )

        # Update memory (keep 30 messages = 15 turns for better context)
        memory.append(user_text)
        memory.append(ai_response)
        if len(memory) > 30:
            del memory[: len(memory) - 30]

        total_ms = (time.time() - turn_start) * 1000
        
        # Get comprehensive latency metrics
        latency_metrics = _latency_tracker.get_metrics()
        
        logger.info(
            "WS turn done | conv=%s | stt=%.0fms | rag=%.0fms | total=%.0fms | sentences=%d",
            conversation_id, 
            latency_metrics.get("stt_ms", 0), 
            latency_metrics.get("rag_ms", 0), 
            total_ms, 
            sentence_count,
        )

        await websocket.send_json({
            "type": "turn_done",
            "ai_response": ai_response,
            "debug_info": {
                "stt_time_ms": latency_metrics.get("stt_ms", 0),
                "rag_time_ms": latency_metrics.get("rag_ms", 0),
                "llm_ttft_ms": latency_metrics.get("llm_ttft_ms", 0),
                "llm_total_ms": latency_metrics.get("llm_total_ms", 0),
                "tts_first_audio_ms": latency_metrics.get("tts_first_audio_ms", 0),
                "tts_total_ms": latency_metrics.get("tts_total_ms", 0),
                "ttfa_ms": latency_metrics.get("ttfa_ms", 0),
                "total_turn_ms": latency_metrics.get("total_turn_ms", 0),
                "first_sentence_ms": round(first_sentence_ms) if first_sentence_ms else 0,
                "sentence_count": sentence_count,
                "knowledge_source": "json" if mode == "test" else "faiss",
            },
        })
        # Mark AI as finished for echo cancellation cooldown
        ai_state["speaking"] = False
        ai_state["finished_at"] = time.time()
        ai_state["last_response"] = ai_response

    except Exception as e:
        logger.error("WS process_utterance failed: %s", e, exc_info=True)
        ai_state["speaking"] = False
        ai_state["finished_at"] = time.time()
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Main WebSocket handler
# ---------------------------------------------------------------------------

async def _handle_voice_ws(websocket: WebSocket):
    """Main WebSocket handler for the voice agent.

    Protocol:
      1. Client sends JSON config: {mode, knowledge_file, institute_id, language}
      2. Server sends greeting audio (sentence events)
      3. Client streams PCM int16 16kHz mono audio frames (binary)
      4. Server detects speech end (energy VAD), transcribes, generates response
      5. Server streams sentence audio back (JSON with base64 audio_data)
      6. Repeat from step 3
    """
    await websocket.accept()
    conversation_id = f"ws_{uuid.uuid4().hex[:12]}"
    conversation_memory: list = []
    mode = "test"
    knowledge_file = "institute.json"
    institute_id = 1
    language = "English"

    try:
        # -- Phase 1: Receive configuration ------------------------------------
        config_msg = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        config = json.loads(config_msg)
        mode = config.get("mode", "test")
        knowledge_file = config.get("knowledge_file", "institute.json")
        institute_id = config.get("institute_id", 1)
        language = config.get("language", "English")

        logger.info(
            "WS voice connected | conv=%s | mode=%s | lang=%s",
            conversation_id, mode, language,
        )

        await websocket.send_json({
            "type": "connected",
            "conversation_id": conversation_id,
        })

        # -- Phase 2: Greeting -------------------------------------------------
        await _send_greeting(
            websocket, mode, knowledge_file, institute_id, language, conversation_memory
        )

        # -- Phase 3: Main loop -- receive audio, detect speech, process --------
        pcm_buffer = bytearray()
        pre_speech_frames: list = []  # rolling buffer of recent silence frames
        silence_frame_count = 0
        is_speaking = False
        frame_count = 0
        turn_start_time = 0.0
        # Echo cancellation: track when AI last spoke to avoid self-interruption
        ai_state = {"speaking": False, "finished_at": 0.0, "last_response": ""}  # mutable container
        BARGE_IN_COOLDOWN_MS = 500  # ignore mic for 500ms after AI stops (increased for better echo suppression)
        current_energy_threshold = ENERGY_THRESHOLD
        # Adaptive threshold based on recent audio levels
        recent_rms_values = []
        # Enhanced turn detector (spec §10)
        _turn_detector.reset()

        while True:
            msg = await websocket.receive()

            if msg["type"] == "websocket.receive":
                if "text" in msg and msg["text"]:
                    # JSON control message
                    try:
                        ctrl = json.loads(msg["text"])
                        if ctrl.get("type") == "config":
                            mode = ctrl.get("mode", mode)
                            knowledge_file = ctrl.get("knowledge_file", knowledge_file)
                            institute_id = ctrl.get("institute_id", institute_id)
                        elif ctrl.get("type") == "end":
                            await websocket.send_json({"type": "ended"})
                            break
                    except json.JSONDecodeError:
                        pass
                    continue

                if "bytes" in msg and msg["bytes"]:
                    audio_data = msg["bytes"]

                    # Check if this is a JSON-in-binary (control message)
                    if len(audio_data) > 2 and audio_data[:1] == b"{":
                        try:
                            ctrl = json.loads(audio_data.decode("utf-8"))
                            if ctrl.get("type") == "end":
                                await websocket.send_json({"type": "ended"})
                                break
                            continue
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            pass

                    # PCM audio frame: int16 mono 16kHz
                    if len(audio_data) < 2:
                        continue

                    # Convert int16 bytes -> float32 numpy
                    samples_int16 = np.frombuffer(audio_data, dtype=np.int16)
                    samples_float = samples_int16.astype(np.float32) / 32768.0

                    # -- Server-side VAD: energy-based speech detection ---------
                    for i in range(0, len(samples_float), FRAME_SAMPLES):
                        frame = samples_float[i : i + FRAME_SAMPLES]
                        if len(frame) < FRAME_SAMPLES // 2:
                            continue

                        rms = float(np.sqrt(np.mean(frame**2)))
                        frame_count += 1
                        
                        # Adaptive threshold: track recent RMS levels
                        recent_rms_values.append(rms)
                        if len(recent_rms_values) > 50:  # Keep last 50 frames (~1 second)
                            recent_rms_values.pop(0)
                        
                        # Echo cancellation: raise threshold right after AI spoke
                        if ai_state["speaking"] or (time.time() - ai_state["finished_at"]) < (BARGE_IN_COOLDOWN_MS / 1000.0):
                            # Much harder to trigger during/after AI speech
                            current_energy_threshold = ENERGY_THRESHOLD * 4
                        else:
                            # Adaptive baseline: use 75th percentile of recent RMS
                            if recent_rms_values:
                                baseline = np.percentile(recent_rms_values, 75)
                                current_energy_threshold = max(ENERGY_THRESHOLD, baseline * 1.5)
                            else:
                                current_energy_threshold = ENERGY_THRESHOLD

                        if rms > current_energy_threshold:
                            if not is_speaking:
                                is_speaking = True
                                _turn_detector.reset()  # Reset turn detector for new utterance
                                pcm_buffer = bytearray()
                                turn_start_time = time.time()
                                # Include pre-speech buffer to avoid clipping the start
                                for pf in pre_speech_frames:
                                    pcm_buffer.extend(pf)
                                pre_speech_frames = []
                                await websocket.send_json({"type": "speech_start"})

                            pcm_buffer.extend(frame.tobytes())

                            # Hard cap: prevent runaway buffers
                            max_frames = int(MAX_UTTERANCE_SECONDS * 1000 / FRAME_MS)
                            if frame_count > max_frames:
                                is_speaking = False
                                frame_count = 0
                                await _process_utterance(
                                    websocket, pcm_buffer, conversation_id,
                                    mode, knowledge_file, institute_id,
                                    language, conversation_memory, ai_state,
                                )
                                pcm_buffer = bytearray()
                                _turn_detector.reset()

                        elif is_speaking:
                            # Silence during speech -- include the gap and update turn detector
                            pcm_buffer.extend(frame.tobytes())
                            # Use enhanced turn detector (spec §10)
                            if _turn_detector.update(False):  # False = silence
                                # Speech ended according to adaptive threshold!
                                is_speaking = False
                                frame_count = 0
                                # Require >300 ms of audio to process
                                min_bytes = int(SAMPLE_RATE * 0.3) * 2  # 16-bit = 2 bytes
                                if len(pcm_buffer) > min_bytes:
                                    await websocket.send_json({"type": "speech_end"})
                                    await _process_utterance(
                                        websocket, pcm_buffer, conversation_id,
                                        mode, knowledge_file, institute_id,
                                        language, conversation_memory, ai_state,
                                    )
                                pcm_buffer = bytearray()
                                _turn_detector.reset()
                        else:
                            # Not speaking yet -- keep a rolling pre-speech buffer
                            pre_speech_frames.append(frame.tobytes())
                            if len(pre_speech_frames) > PRE_SPEECH_FRAMES:
                                pre_speech_frames.pop(0)

            elif msg["type"] == "websocket.disconnect":
                break

    except asyncio.TimeoutError:
        logger.warning("WS voice: config timeout (conv=%s)", conversation_id)
    except WebSocketDisconnect:
        logger.info("WS voice: client disconnected (conv=%s)", conversation_id)
    except Exception as e:
        logger.error("WS voice error (conv=%s): %s", conversation_id, e, exc_info=True)
        try:
            await websocket.send_json({"type": "error", "detail": str(e)})
        except Exception:
            pass
    finally:
        logger.info("WS voice: session ended (conv=%s)", conversation_id)


# ---------------------------------------------------------------------------
# FastAPI WebSocket route
# ---------------------------------------------------------------------------

@router.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """WebSocket endpoint for real-time voice conversation.

    Protocol:
      1. Client sends JSON config: {mode, knowledge_file, institute_id, language}
      2. Server sends greeting audio (sentence events)
      3. Client streams PCM int16 16kHz mono audio frames (binary)
      4. Server detects speech end (energy VAD), transcribes, generates response
      5. Server streams sentence audio back (JSON with base64 audio_data)
      6. Repeat from step 3
    """
    await _handle_voice_ws(websocket)
