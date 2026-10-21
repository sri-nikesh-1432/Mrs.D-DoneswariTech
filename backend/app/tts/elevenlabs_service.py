"""
ElevenLabs Text-to-Speech service.

Premium voice engine for the voice agent. When ELEVENLABS_API_KEY is set
in the environment, `get_tts_service()` returns this service so the voice
agent speaks with an ElevenLabs voice instead of Edge TTS.

Implements the SAME public interface as EdgeTTSService so callers
(voice_ws, media_stream, conversation_routes, single_call_routes, ...)
work unchanged:

    initialize()
    synthesize(text, voice, language, speed) -> bytes | None   (MP3)
    synthesize_sentences(...) -> [{text, audio_data(base64)}]
    stream_sentences(...)     -> async gen {index, text, audio_data}
    synthesize_pcm(...)       -> bytes | None                   (PCM16 16k mono)
    get_available_voices()    -> list[str]
"""

import asyncio
import base64
import io
from typing import Optional

import httpx

from app.config.settings import settings
from app.logs.logger import get_logger
from app.roman_telugu import (
    normalize_for_speech,
    clean_tts_text,
    split_into_sentences,
)

logger = get_logger(__name__)

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"


def base64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


class ElevenLabsTTSService:
    """ElevenLabs-based text-to-speech service."""

    def __init__(self):
        self.api_key = settings.ELEVENLABS_API_KEY
        self.voice_id = settings.ELEVENLABS_VOICE_ID
        self.model_id = settings.ELEVENLABS_MODEL_ID
        self.fallback_voice_id = settings.ELEVENLABS_FALLBACK_VOICE_ID
        self.allow_edge_fallback = settings.ELEVENLABS_ALLOW_EDGE_FALLBACK
        # Voice ids this account rejected (401/402/403/404) — remembered for
        # the process so every later sentence skips the failing round-trip.
        self._blocked_voices: set = set()
        self.is_initialized = False

    async def initialize(self):
        """Initialize ElevenLabs client (validates the API key lazily)."""
        if self.is_initialized:
            return
        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY not configured")
        self.is_initialized = True
        logger.info("ElevenLabs TTS initialized (voice=%s, model=%s)", self.voice_id, self.model_id)

    # ── Voice resolution ────────────────────────────────────────────────
    def _resolve_voice(self, voice: Optional[str]) -> str:
        """Pick the ElevenLabs voice id.

        Agent-level `voice` values from the DB may be ElevenLabs voice ids
        (e.g. '0U7pUcfIxJzwwTseQz75' or 'EXAVITQu4vr4xnSDxMaL') OR legacy
        Edge-TTS names ('en-IN-NeerjaNeural'). Only a real ElevenLabs id is
        honored; everything else falls back to the configured default voice.
        ElevenLabs ids are base64-ish tokens of ~11-22 chars that contain no
        dashes/dots (Edge names always contain '-'), so the check is safe.
        """
        if voice and voice.strip():
            v = voice.strip()
            if v not in self._blocked_voices and len(v) >= 11 and len(v) <= 30 and "-" not in v and "." not in v:
                return v
        return self.voice_id or self.fallback_voice_id or "hpp4J3VqNfWAUOO0d1Us"

    # ── Core synthesis ──────────────────────────────────────────────────
    async def _post_tts(
        self, spoken: str, vid: str, stability: float, similarity_boost: float,
    ) -> tuple[Optional[bytes], Optional[int]]:
        """POST one TTS request for a specific voice id.

        Returns (audio_bytes, http_status). On any failure audio is None and
        the status is the HTTP code (or None for network/parse errors).
        """
        url = f"{ELEVENLABS_BASE}/text-to-speech/{vid}"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": spoken,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost,
                "style": 0.2,
                "use_speaker_boost": True,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                status = response.status_code
                if status != 200:
                    logger.error(
                        "ElevenLabs TTS voice=%s HTTP %s: %s",
                        vid, status, response.text[:200],
                    )
                    return None, status
                audio = response.content
            if not audio:
                logger.warning("ElevenLabs returned empty audio (voice=%s)", vid)
                return None, status
            return audio, status
        except Exception as e:
            logger.error("ElevenLabs TTS request failed (voice=%s): %s", vid, e)
            return None, None

    @staticmethod
    def _settings_for_speed(speed: Optional[float]) -> tuple[float, float]:
        """Map the agent's configured pace to (stability, similarity_boost)."""
        stability = 0.5
        if speed is not None:
            try:
                s = float(speed)
                if abs(s - 1.0) >= 0.05:
                    stability = max(0.2, min(0.75, 0.5 + (1.0 - s) * 0.2))
            except (TypeError, ValueError):
                pass
        return stability, 0.8

    async def _synthesize_mp3(
        self, text: str, voice: Optional[str] = None, speed: Optional[float] = None,
    ) -> Optional[bytes]:
        """Synthesize text -> MP3 bytes, with graceful voice fallback.

        Chain (each layer runs only if the previous produced no audio):
          1. The voice resolved from the agent / configured default
             (ELEVENLABS_VOICE_ID).
          2. ELEVENLABS_FALLBACK_VOICE_ID — a premade voice, always allowed on
             every plan. A library voice on a Free account returns HTTP 402
             "paid_plan_required", so this keeps the agent speaking.
          3. Edge TTS — a total ElevenLabs outage must never leave the agent
             silent (ELEVENLABS_ALLOW_EDGE_FALLBACK).

        Voices rejected with 401/402/403/404 are remembered for the process so
        every following sentence skips straight to the working voice instead of
        re-paying the failing round-trip.
        """
        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY not configured")

        stability, similarity_boost = self._settings_for_speed(speed)

        primary = self._resolve_voice(voice)
        candidates: list = []
        if primary and primary not in self._blocked_voices:
            candidates.append(primary)
        fallback = self.fallback_voice_id
        if fallback and fallback not in candidates and fallback not in self._blocked_voices:
            candidates.append(fallback)

        for cand in candidates:
            audio, status = await self._post_tts(text, cand, stability, similarity_boost)
            if audio:
                if cand != primary:
                    logger.info(
                        "ElevenLabs voice %s unusable; speaking with fallback voice %s",
                        primary, cand,
                    )
                return audio
            if status in (401, 402, 403, 404):
                self._blocked_voices.add(cand)
                logger.warning(
                    "ElevenLabs voice %s not permitted for this account (HTTP %s); skipping",
                    cand, status,
                )

        if self.allow_edge_fallback:
            audio = await self._edge_mp3(text)
            if audio:
                logger.info(
                    "ElevenLabs produced no audio; Edge-TTS fallback returned %d bytes",
                    len(audio),
                )
                return audio

        return None

    async def _edge_mp3(self, text: str) -> Optional[bytes]:
        """Last-resort Edge-TTS synthesis (MP3) so the agent is never silent."""
        try:
            svc = _get_edge_fallback()
            # Do NOT pass the ElevenLabs voice id to Edge (it is not an Edge
            # voice name); let Edge pick by the text's script / its default.
            return await svc.synthesize(text, voice=None, language=None, speed=None)
        except Exception as e:
            logger.error("Edge-TTS fallback failed: %s", e)
            return None

    # ── Interface: single-shot synthesize ───────────────────────────────
    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> Optional[bytes]:
        """Synthesize text to MP3 audio bytes."""
        if not self.is_initialized:
            await self.initialize()

        if not text or not text.strip():
            return None

        try:
            spoken = clean_tts_text(normalize_for_speech(text))
            if not spoken:
                return None
            return await self._synthesize_mp3(spoken, voice=voice, speed=speed)
        except Exception as e:
            logger.error("ElevenLabs synthesize error: %s", e)
            return None

    # ── Interface: sentence-by-sentence ─────────────────────────────────
    async def synthesize_sentences(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        max_sentences: int = 20,
        speed: Optional[float] = None,
    ) -> list:
        """Synthesize sentence-by-sentence; returns [{text, audio_data}].

        ElevenLabs is called once per sentence so the frontend queue gets
        complete units (never mid-sentence cut-offs). Sentences are
        synthesized concurrently (bounded) to reduce latency.
        """
        if not self.is_initialized:
            await self.initialize()

        all_sentences = split_into_sentences(text)
        if len(all_sentences) > max_sentences:
            all_sentences = all_sentences[:max_sentences]
        if not all_sentences:
            return []

        sem = asyncio.Semaphore(2)  # ElevenLabs throttles parallel calls

        async def _synth(index: int, sentence: str):
            async with sem:
                try:
                    spoken = clean_tts_text(normalize_for_speech(sentence))
                    if not spoken:
                        return {"text": sentence, "audio_data": None}
                    audio = await self._synthesize_mp3(spoken, voice=voice, speed=speed)
                    if not audio:
                        return {"text": sentence, "audio_data": None}
                    return {"text": sentence, "audio_data": base64_encode(audio)}
                except Exception as e:
                    logger.error("Sentence ElevenLabs TTS failed: %s", e)
                    return {"text": sentence, "audio_data": None}

        results = await asyncio.gather(*[_synth(i, s) for i, s in enumerate(all_sentences)])
        return list(results)

    # ── Interface: streaming generator ──────────────────────────────────
    async def stream_sentences(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        max_sentences: int = 20,
        speed: Optional[float] = None,
    ):
        """Async generator yielding sentence audio in order as it is ready.

        Yields dicts: {"index": int, "text": str, "audio_data": base64-or-None}
        """
        if not self.is_initialized:
            await self.initialize()

        all_sentences = split_into_sentences(text)[:max_sentences]
        if not all_sentences:
            return

        sem = asyncio.Semaphore(2)
        total_sentences = len(all_sentences)

        async def _synth(index: int, sentence: str):
            async with sem:
                try:
                    spoken = clean_tts_text(normalize_for_speech(sentence))
                    if not spoken:
                        return index, sentence, None
                    audio = await self._synthesize_mp3(spoken, voice=voice, speed=speed)
                    return index, sentence, audio or None
                except Exception as e:
                    logger.error("Streaming ElevenLabs TTS failed: %s", e)
                    return index, sentence, None

        pending = {}
        next_index = 0
        tasks = [asyncio.create_task(_synth(i, s)) for i, s in enumerate(all_sentences)]
        for task in asyncio.as_completed(tasks):
            index, sentence, audio = await task
            pending[index] = (sentence, audio)
            while next_index in pending:
                sentence_i, audio_i = pending.pop(next_index)
                yield {
                    "index": next_index,
                    "text": sentence_i,
                    "audio_data": base64_encode(audio_i) if audio_i else None,
                }
                next_index += 1

    # ── Interface: PCM (telephony / Twilio path) ────────────────────────
    async def synthesize_pcm(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> Optional[bytes]:
        """Synthesize text to raw PCM16 @16 kHz mono (telephony path).

        ElevenLabs returns MP3; decode to 16 kHz mono PCM16 via pydub
        (ffmpeg backend) so the Twilio bridge can convert to µ-law.
        """
        if not self.is_initialized:
            await self.initialize()

        if not text or not text.strip():
            return None

        try:
            spoken = clean_tts_text(normalize_for_speech(text))
            if not spoken:
                return None
            mp3 = await self._synthesize_mp3(spoken, voice=voice, speed=speed)
            if not mp3:
                return None
            return await asyncio.get_event_loop().run_in_executor(
                None, self._decode_mp3_to_pcm16, mp3
            )
        except Exception as e:
            logger.error("ElevenLabs PCM synthesis failed: %s", e)
            return None

    @staticmethod
    def _decode_mp3_to_pcm16(mp3_bytes: bytes) -> Optional[bytes]:
        """Decode MP3 -> PCM16 16 kHz mono using pydub + ffmpeg."""
        try:
            from pydub import AudioSegment
        except ImportError:
            logger.error("pydub not installed; cannot decode MP3 to PCM")
            return None
        try:
            seg = AudioSegment.from_file(io.BytesIO(mp3_bytes), format="mp3")
            seg = seg.set_frame_rate(16000).set_channels(1).set_sample_width(2)
            return seg.raw_data
        except Exception as e:
            logger.error("MP3->PCM decode failed: %s", e)
            return None

    # ── Interface: available voices ─────────────────────────────────────
    async def get_available_voices(self) -> list:
        """Fetch ElevenLabs voice list (id + name)."""
        if not self.api_key:
            return []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{ELEVENLABS_BASE}/voices",
                    headers={"xi-api-key": self.api_key},
                )
                if resp.status_code == 200:
                    return resp.json().get("voices", [])
        except Exception as e:
            logger.error("ElevenLabs get_available_voices failed: %s", e)
        return []


# Global ElevenLabs TTS instance
_elevenlabs_service: Optional[ElevenLabsTTSService] = None

# Lazy Edge-TTS fallback (imported at call time to avoid a circular import
# with edge_tts_service, whose get_tts_service() imports this module).
_edge_fallback_service: Optional[object] = None


def _get_edge_fallback():
    global _edge_fallback_service
    if _edge_fallback_service is None:
        from app.tts.edge_tts_service import EdgeTTSService
        _edge_fallback_service = EdgeTTSService()
    return _edge_fallback_service


def get_elevenlabs_service() -> ElevenLabsTTSService:
    """Get or create global ElevenLabs TTS service instance."""
    global _elevenlabs_service
    if _elevenlabs_service is None:
        _elevenlabs_service = ElevenLabsTTSService()
    return _elevenlabs_service