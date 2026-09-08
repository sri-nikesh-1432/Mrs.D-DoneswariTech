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
from app.rag.groq_service import generate_response, stream_chat, stream_chat_fast
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



def _detect_language(user_input: str, hint: Optional[str] = None) -> str:
    """Thin wrapper over the global LanguageDetector for callers that import from
    voice_ws (e.g. analytics latency-test) without depending on the SSE route
    helpers.
    """
    return _language_detector.detect(user_input, stt_language=hint)


LANGUAGE_INSTRUCTION = (
    "## Call Instructions\n"
    "You are Mrs. D on a live admissions call. Reply in {language} (the caller's language - "
    "Roman Telugu like 'idhi enti' or 'naku MPC kavali' counts as Telugu; reply in Telugu script).\n"
    "\n"
    "BEHAVIOUR (follow strictly):\n"
    "- Never restate the caller's words as a verbatim repeat.\n"
    "- Acknowledge naturally and briefly ONLY when it fits - and VARY it by context.\n"
    "- ANSWER COMPLETELY. When the caller asks for details, give the FULL breakdown.\n"
    "- NEVER end with a follow-up question just to keep the call going.\n"
    "- DO NOT HALLUCINATE. Use ONLY the provided knowledge. If it isn't there, say so plainly.",
    "- Keep it SHORT like a phone call: 2-5 conversational sentences.",
    "- Speak like a warm professional counsellor: confident, concise, human.",
    "- NEVER fall into a repetitive opener; vary acknowledgements naturally.",
    "- Use natural fillers contextually and vary them: 'Hmm...', 'Sare...', 'Okay...', "
    "'One second...', 'Sure...'\n",
    "- If you don't know something, say so plainly instead of guessing.",
    "- Close naturally when the caller seems satisfied; don't keep the call going.",
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
# RMS below this = silence. 0.008 is deliberately LOW so soft/quiet callers
# (small voices, low mic gain, far from the phone) are still detected — the
# adaptive baseline + echo-cancellation threshold lift protect against noise
# triggering phantom turns.
ENERGY_THRESHOLD = 0.008

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
            # Vary the greeting opener so every call does not start identically.
            opener = random.choice(GREETING_OPENERS)
            greeting_prompt = (
                f"You are Mrs. D, a warm admissions counsellor speaking on a live call.\r\n"
                f"You are representing {institute_name}.\r\n\r\n"
                f"Start your reply with a natural opener that sounds like you work at {institute_name} "
                f"and are calling a prospective parent (keep it in {language}, adapt phrasing naturally):\r\n"
                f"{opener}\r\n\r\n"
                f"Then briefly invite the caller to ask about admissions, courses, fees, hostel or scholarships. "
                f"Keep the whole greeting to 2-3 sentences and sound like a real person on the phone."
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
        lang_hint = (
            "You are Mrs. D, a warm admissions counsellor on a live call.\n"
            f"Reply in {detected_lang}. 2-3 sentences, natural and concise.\n"
            "Never restate the caller words. If unsure, say you don't have that detail.\n"
            f"Knowledge: {context[-900:] if isinstance(context, str) else ''}"
        )


        sentence_q: asyncio.Queue = asyncio.Queue()


        ai_parts: list[str] = []
        llm_error: str | None = None
        first_audio_at = 0.0

        # --- LLM streaming (fast path for voice) ----------------------------------
        async def _llm_streamer():
            nonlocal ai_parts, llm_error
            buf = ""
            _latency_tracker.start_llm()
            try:
                query_text = f"{llm_input}\n{lang_hint}"
                async for delta in stream_chat_fast(
                    query_text,
                    detected_lang,
                    history_list[-2:] if len(history_list) >= 2 else history_list,
                    context,
                ):
                    if not ai_parts:
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
                logger.error("WS LLM streaming failed (conv=%s): %s", conversation_id, e)
                llm_error = str(e)
                await sentence_q.put(("error", llm_error))
            finally:
                _latency_tracker.end_llm()
                await sentence_q.put(("end", None))

        llm_task = asyncio.create_task(_llm_streamer())

        # --- TTS: synthesize each complete sentence as soon as the LLM emits it ---
        tts_service = get_tts_service()
        sentence_count = 0
        first_sentence_text = ""
        try:
            _latency_tracker.start_tts()
            while True:
                kind = await sentence_q.get()
                if kind[0] == "end":
                    break
                if kind[0] == "error":
                    break

                _idx, payload = kind[1], kind[2]
                if not payload:
                    continue

                now = time.time()
                if sentence_count == 0:
                    first_audio_at = now

                async for chunk in tts_service.stream_sentences(payload, language=detected_lang):
                    audio = chunk.get("audio_data")
                    if not audio:
                        continue
                    _latency_tracker.mark_tts_first_audio()
                    await websocket.send_json({
                        "type": "sentence",
                        "index": sentence_count,
                        "text": chunk["text"],
                        "audio_data": audio,
                    })
                    if sentence_count == 0 and not first_sentence_text:
                        first_sentence_text = chunk["text"]
                    sentence_count += 1
        finally:
            if not llm_task.done():
                llm_task.cancel()
            try:
                await llm_task
            except asyncio.CancelledError:
                pass
            _latency_tracker.end_tts()

        if first_audio_at:
            _latency_tracker.tts_first_audio = first_audio_at

        ai_response = "".join(ai_parts).strip()
        memory.append(user_text)
        memory.append(ai_response)
        ai_state["last_response"] = ai_response
        ai_state["speaking"] = False
        ai_state["finished_at"] = time.time()

        metrics = _latency_tracker.get_metrics()
        metrics["sentence_count"] = sentence_count
        metrics["first_sentence_text"] = first_sentence_text[:120]
        metrics["llm_error"] = llm_error
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
        logger.exception("WS utterance processing failed (conv=%s): %s", conversation_id, e)
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

@router.websocket("/voice/{agent_id}")
async def ws_voice_agent(websocket: WebSocket):
    """Real-time bidirectional voice WebSocket for a published agent.

    Client -> Server: PCM 16 kHz mono audio frames (binary)
    Server -> Client: JSON control messages + base64 MP3 sentence audio

    Flow:
      1. Client opens WS, sends {type: "hello", ...}
      2. Server sends greeting sentences (streamed TTS)
      3. Client streams audio frames; server runs VAD -> STT -> LLM -> TTS
      4. On disconnect, session is cleaned up
    """
    await websocket.accept()
    logger.info("WS voice connect: agent=%s client=%s", websocket.path, websocket.client)

    try:
        hello = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
        mode = str(hello.get("mode") or "live").lower()
        knowledge_file = str(hello.get("knowledge_file") or "institute.json")
        institute_id = int(hello.get("institute_id") or 0)
        language = str(hello.get("language") or "English")
        conversation_id = str(hello.get("conversation_id") or uuid.uuid4().hex[:12])
        memory: list = json.loads(hello.get("memory") or "[]")
    except Exception as e:
        logger.warning("WS hello failed: %s", e)
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Handshake failed: {e}",
            })
        except Exception:
            pass
        return

    ai_state: dict = {"speaking": False, "finished_at": 0.0, "last_response": ""}

    await _send_greeting(websocket, mode, knowledge_file, institute_id, language, memory, ai_state)

    pcm_buffer: bytearray = bytearray()
    speech_started = False
    utterance_frames = 0

    try:
        while True:
            frame = await asyncio.wait_for(
                websocket.receive_bytes(),
                timeout=2.0,
            )
            if len(frame) < 4:
                continue

            try:
                pcm_int16 = np.frombuffer(frame, dtype=np.int16)
                pcm_float = pcm_int16.astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(pcm_float ** 2)))
            except Exception:
                continue

            is_speech = rms > ENERGY_THRESHOLD

            if is_speech:
                if not speech_started:
                    speech_started = True
                pcm_buffer.extend(frame)
                utterance_frames += 1
            else:
                if speech_started:
                    pcm_buffer.extend(frame)
                    utterance_frames += 1

            if speech_started and not is_speech:
                should_cut = _turn_detector.update(False)
                if should_cut and utterance_frames >= PRE_SPEECH_FRAMES:
                    _turn_detector.reset()
                    if len(pcm_buffer) >= FRAME_SAMPLES * 5:
                        pcm_copy = bytearray(pcm_buffer)
                        pcm_buffer.clear()
                        speech_started = False
                        utterance_frames = 0
                        await _process_utterance(
                            websocket,
                            pcm_copy,
                            conversation_id,
                            mode,
                            knowledge_file,
                            institute_id,
                            language,
                            memory,
                            ai_state,
                        )
                    else:
                        pcm_buffer.clear()
                        speech_started = False
                        utterance_frames = 0
            elif is_speech:
                if not speech_started:
                    _turn_detector.reset()
                _turn_detector.update(True)
    except WebSocketDisconnect:
        logger.info("WS voice disconnect: agent=%s", websocket.path)
    except asyncio.TimeoutError:
        logger.info("WS voice timeout: agent=%s", websocket.path)
    except Exception as e:
        logger.exception("WS voice loop error: %s", e)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
