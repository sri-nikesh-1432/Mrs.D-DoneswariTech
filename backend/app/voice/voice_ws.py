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
# Language detection (mirrors conversation_routes._detect_language)
# ---------------------------------------------------------------------------

def _detect_language(user_input: str, hint: Optional[str] = None) -> str:
    if _re.search(r"[\u0C00-\u0C7F]", user_input):
        return "Telugu"
    if looks_roman_telugu(user_input):
        return "Telugu"
    if hint and hint.lower() in ("te", "telugu"):
        return "Telugu"
    if hint and hint.lower() in ("hi", "hindi"):
        return "Hindi"
    if hint and hint.lower() in ("ta", "tamil"):
        return "Tamil"
    if hint and hint.lower() in ("kn", "kannada"):
        return "Kannada"
    if hint and hint.lower() in ("ml", "malayalam"):
        return "Malayalam"
    return "English"


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
)


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
    """Convert flat memory into alternating user/model history for the LLM."""
    history_list = []
    for i, msg in enumerate(memory[-6:]):
        role = "model" if i % 2 == 0 else "user"
        content = str(msg)[:300]
        history_list.append({"role": role, "content": content})
    return history_list


# ---------------------------------------------------------------------------
# Server-side VAD parameters
# ---------------------------------------------------------------------------
# Simple energy-based VAD: when RMS drops below threshold for N consecutive
# frames, we consider the utterance complete.  This is cheaper than loading
# the full Silero ONNX model on the backend while still being effective for
# the primary use-case (detecting when the caller stops speaking).

SAMPLE_RATE = 16000
FRAME_MS = 20  # 20 ms per frame — finer granularity for faster response
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)  # 320 samples
ENERGY_THRESHOLD = 0.012  # RMS below this = silence (slightly lower to catch softer speech)
SILENCE_FRAMES_TO_END = 35  # ~700 ms of silence — fast end-of-turn (Retell AI target)
MAX_UTTERANCE_SECONDS = 30  # hard cap
# Pre-speech buffer: keep 200ms of audio BEFORE speech onset to avoid clipping
PRE_SPEECH_MS = 200
PRE_SPEECH_FRAMES = int(PRE_SPEECH_MS / FRAME_MS)


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
):
    """Process a detected utterance: STT -> LLM -> TTS, streaming back over WS."""
    try:
        turn_start = time.time()

        # Track AI speaking state for echo cancellation
        nonlocal ai_speaking, ai_finished_at
        ai_speaking = True
        
        # Notify client: we're processing
        await websocket.send_json({"type": "processing"})

        # -- STT ------------------------------------------------------------------
        pcm_float = (
            np.frombuffer(bytes(pcm_buffer), dtype=np.int16).astype(np.float32) / 32768.0
        )

        stt_start = time.time()
        stt_result = await _transcribe_pcm(pcm_float)
        stt_ms = (time.time() - stt_start) * 1000

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

        # Send transcription to client for display
        await websocket.send_json({
            "type": "transcript",
            "text": user_text,
            "language": detected_lang_code,
        })

        detected_lang = _detect_language(user_text, hint=language)
        llm_input = transliterate_roman_telugu(user_text)

        # -- RAG ------------------------------------------------------------------
        rag_start = time.time()
        if mode == "test":
            retriever = get_json_retriever(knowledge_file)
            context = retriever.retrieve_context(llm_input, top_k=5)
        else:
            retrieved_chunks = await retrieve_context(llm_input, top_k=5)
            context = format_context_for_prompt(retrieved_chunks)
        rag_ms = (time.time() - rag_start) * 1000

        # -- LLM streaming + sentence-level TTS -----------------------------------
        history_list = _build_history(memory)
        lang_hint = LANGUAGE_INSTRUCTION.format(language=detected_lang)
        sentence_q: asyncio.Queue = asyncio.Queue()
        ai_parts: list = []
        llm_error: Optional[str] = None

        async def _llm_streamer():
            nonlocal ai_parts
            buf = ""
            try:
                async for delta in stream_chat(
                    f"{llm_input}\n\n{lang_hint}", history_list, context
                ):
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
                await sentence_q.put(("end", None))

        llm_task = asyncio.create_task(_llm_streamer())
        synth_lang = detected_lang
        sentence_count = 0
        first_sentence_ms = 0

        try:
            while True:
                kind = await sentence_q.get()
                if kind[0] == "end":
                    break
                if kind[0] == "error":
                    llm_error = kind[1]
                    break

                _idx, payload = kind[1], kind[2]
                tts_start = time.time()
                async for chunk in tts_service.stream_sentences(
                    payload, language=synth_lang
                ):
                    if chunk.get("audio_data") is None:
                        continue
                    if first_sentence_ms == 0:
                        first_sentence_ms = (time.time() - turn_start) * 1000
                    await websocket.send_json({
                        "type": "sentence",
                        "index": _idx,
                        "text": chunk["text"],
                        "audio_data": chunk["audio_data"],
                    })
                    sentence_count += 1
                tts_ms = (time.time() - tts_start) * 1000
        finally:
            if not llm_task.done():
                llm_task.cancel()

        ai_response = "".join(ai_parts).strip()
        if llm_error and not ai_response:
            ai_response = (
                "I can help with that. We offer MPC, BiPC, MEC and CEC streams. "
                "What would you like to know more about - courses, fees or admission?"
            )

        # Update memory
        memory.append(user_text)
        memory.append(ai_response)
        if len(memory) > 20:
            del memory[: len(memory) - 20]

        total_ms = (time.time() - turn_start) * 1000
        logger.info(
            "WS turn done | conv=%s | stt=%.0fms | rag=%.0fms | total=%.0fms | sentences=%d",
            conversation_id, stt_ms, rag_ms, total_ms, sentence_count,
        )

        await websocket.send_json({
            "type": "turn_done",
            "ai_response": ai_response,
            "debug_info": {
                "stt_time_ms": round(stt_ms),
                "rag_time_ms": round(rag_ms),
                "first_sentence_ms": round(first_sentence_ms) if first_sentence_ms else 0,
                "total_time_ms": round(total_ms),
                "sentence_count": sentence_count,
                "knowledge_source": "json" if mode == "test" else "faiss",
            },
        })
        # Mark AI as finished for echo cancellation cooldown
        ai_speaking = False
        ai_finished_at = time.time()

    except Exception as e:
        logger.error("WS process_utterance failed: %s", e, exc_info=True)
        ai_speaking = False
        ai_finished_at = time.time()
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
        ai_speaking = False  # true while TTS audio is being sent to client
        ai_finished_at = 0.0  # timestamp when AI last finished speaking
        BARGE_IN_COOLDOWN_MS = 400  # ignore mic for 400ms after AI stops
        current_energy_threshold = ENERGY_THRESHOLD

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
                        
                        # Echo cancellation: raise threshold right after AI spoke
                        if ai_speaking or (time.time() - ai_finished_at) < (BARGE_IN_COOLDOWN_MS / 1000.0):
                            current_energy_threshold = ENERGY_THRESHOLD * 3  # much harder to trigger
                        else:
                            current_energy_threshold = ENERGY_THRESHOLD

                        if rms > current_energy_threshold:
                            if not is_speaking:
                                is_speaking = True
                                silence_frame_count = 0
                                pcm_buffer = bytearray()
                                turn_start_time = time.time()
                                # Include pre-speech buffer to avoid clipping the start
                                for pf in pre_speech_frames:
                                    pcm_buffer.extend(pf)
                                pre_speech_frames = []
                                await websocket.send_json({"type": "speech_start"})

                            pcm_buffer.extend(frame.tobytes())
                            silence_frame_count = 0

                            # Hard cap: prevent runaway buffers
                            max_frames = int(MAX_UTTERANCE_SECONDS * 1000 / FRAME_MS)
                            if frame_count > max_frames:
                                is_speaking = False
                                frame_count = 0
                                await _process_utterance(
                                    websocket, pcm_buffer, conversation_id,
                                    mode, knowledge_file, institute_id,
                                    language, conversation_memory,
                                )
                                pcm_buffer = bytearray()
                                silence_frame_count = 0

                        elif is_speaking:
                            # Silence during speech -- include the gap
                            pcm_buffer.extend(frame.tobytes())
                            silence_frame_count += 1
                        else:
                            # Not speaking yet -- keep a rolling pre-speech buffer
                            pre_speech_frames.append(frame.tobytes())
                            if len(pre_speech_frames) > PRE_SPEECH_FRAMES:
                                pre_speech_frames.pop(0)

                            if silence_frame_count >= SILENCE_FRAMES_TO_END:
                                # Speech ended!
                                is_speaking = False
                                frame_count = 0
                                # Require >300 ms of audio to process
                                min_bytes = int(SAMPLE_RATE * 0.3) * 2  # 16-bit = 2 bytes
                                if len(pcm_buffer) > min_bytes:
                                    await websocket.send_json({"type": "speech_end"})
                                    await _process_utterance(
                                        websocket, pcm_buffer, conversation_id,
                                        mode, knowledge_file, institute_id,
                                        language, conversation_memory,
                                    )
                                pcm_buffer = bytearray()
                                silence_frame_count = 0

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
