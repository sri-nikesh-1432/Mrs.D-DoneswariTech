"""
Edge-TTS Text-to-Speech service.
Generates audio from AI responses.
"""

import asyncio
import base64
import html
import os
import random
import re
from typing import Optional
import logging

from app.logs.logger import get_logger
from app.roman_telugu import (
    normalize_for_speech,
    clean_tts_text,
    split_into_sentences,
)
from app.tts.raw_ssml import get_raw_synth, get_raw_synth_pcm

logger = get_logger(__name__)


def base64_encode(data: bytes) -> str:
    """Base64-encode audio bytes for transport to the frontend."""
    return base64.b64encode(data).decode("utf-8")


def _xml_lang_for(voice: str) -> str:
    """'te-IN-ShrutiNeural' -> 'te-IN' (SSML xml:lang must match the voice)."""
    parts = voice.split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else "en-US"


class EdgeTTSService:
    """Edge-TTS based text-to-speech service."""
    
    def __init__(self):
        # Indian neural voices per language (validated against edge_tts list_voices).
        # Main + Alt entries so voice rotation never picks a nonexistent voice.
        self.voices = {
            "English": "en-IN-NeerjaExpressiveNeural",   # Indian English female, expressive variant
            "English-Clear": "en-IN-NeerjaNeural",      # Indian English female, neutral/clear
            "English-Alt": "en-IN-PrabhatNeural",        # Indian English male
            "Telugu": "te-IN-ShrutiNeural",          # Telugu female
            "Telugu-Alt": "te-IN-MohanNeural",       # Telugu male
            "Hindi": "hi-IN-SwaraNeural",            # Hindi female
            "Hindi-Alt": "hi-IN-MadhurNeural",       # Hindi male
            "Tamil": "ta-IN-PallaviNeural",          # Tamil female
            "Tamil-Alt": "ta-IN-ValluvarNeural",     # Tamil male
            "Kannada": "kn-IN-SapnaNeural",          # Kannada female
            "Kannada-Alt": "kn-IN-GaganNeural",      # Kannada male
            "Malayalam": "ml-IN-SobhanaNeural",      # Malayalam female
            "Malayalam-Alt": "ml-IN-MidhunNeural",   # Malayalam male
        }
        self.voice = os.getenv("TTS_VOICE", "en-IN-NeerjaExpressiveNeural")
        self.rate = os.getenv("TTS_RATE", "+10%")  # ~1.1x speed, calm counsellor pace
        self.pitch = os.getenv("TTS_PITCH", "+0Hz")
        self.is_initialized = False
    
    async def initialize(self):
        """Initialize Edge-TTS."""
        if self.is_initialized:
            return
        
        try:
            import edge_tts
            self.is_initialized = True
            logger.info("Edge-TTS initialized successfully")
        except ImportError:
            logger.error("Edge-TTS not installed. Install with: pip install edge-tts")
            raise
        except Exception as e:
            logger.error(f"Error initializing Edge-TTS: {e}")
            raise
    
    async def synthesize(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> Optional[bytes]:
        """
        Synthesize text to audio.
        
        Args:
            text: Text to synthesize
            voice: Voice to use (default from env or language)
            language: Language for automatic voice selection
            speed: Agent's configured speaking pace (1.0 = neutral)
        
        Returns:
            Audio bytes (MP3 format) or None if synthesis fails
        """
        if not self.is_initialized:
            await self.initialize()
        
        if not text or not text.strip():
            return None
        
        try:
            import edge_tts
            
            # Normalize fees/numbers/abbreviations so they are SPOKEN naturally
            # (ఒక లక్ష రూపాయలు, Two Thousand Twenty Six, ఎం పి సి) instead of
            # being read digit-by-digit. clean_tts_text() is the FINAL guard:
            # debug/telemetry text can never reach the voice.
            spoken_text = clean_tts_text(normalize_for_speech(text))
            if not spoken_text:
                logger.warning("TTS input empty after cleaning; skipping")
                return None

            # Auto-select voice based on language. CRITICAL: the language hint
            # sent by the frontend can disagree with the language the LLM
            # actually wrote in (e.g. hint="English" but a Telugu reply). Edge
            # TTS returns "No audio was received" when the voice and script
            # don't match, so detect the script of the REAL text first and only
            # fall back to the hint when the text has no regional script.
            # NOTE: the script check runs on the ORIGINAL `text`, not the
            # normalized version — normalize_for_speech injects Telugu script
            # for abbreviations ("MPC" → "ఎం పి సి"), which must not flip an
            # English reply onto a Telugu voice.
            voice_to_use = self._pick_voice(text, language=language, voice=voice)
            logger.debug(f"Synthesizing: {spoken_text[:50]}... with voice: {voice_to_use}")

            # Same natural-prosody engine the streaming path uses, so a
            # one-shot synthesis sounds like the same person speaking.
            rate, pitch, volume = self._prosody_for(text, index=0, total=1, speed=speed)

            # Create communicate object
            communicate = edge_tts.Communicate(
                spoken_text,
                voice_to_use,
                rate=rate,
                pitch=pitch,
                volume=volume,
            )
            
            # Generate audio by iterating over async generator
            audio_chunks = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_chunks.append(chunk["data"])
            
            audio_data = b"".join(audio_chunks)
            
            logger.debug(f"Synthesized {len(audio_data)} bytes")
            return audio_data
            
        except Exception as e:
            logger.error(f"Error synthesizing speech: {e}")
            return None
    
    async def synthesize_sentences(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        max_sentences: int = 20,
        speed: Optional[float] = None,
    ) -> list:
        """
        Synthesize text sentence-by-sentence.

        Each sentence is synthesized independently and returned as its own
        entry, so the frontend can play them in sequence with an audio queue:
          - No single giant 30-second TTS request.
          - No mid-sentence cut-off: each unit is a COMPLETE sentence.
          - Sentences are generated concurrently (bounded) to reduce latency.

        Returns a list of dicts: [{"text": ..., "audio_data": base64-or-None}]
        """
        all_sentences = split_into_sentences(text)
        if len(all_sentences) > max_sentences:
            logger.warning(
                "Response has %d sentences; capping audio to first %d (text still shown in full)",
                len(all_sentences), max_sentences,
            )
        sentences = all_sentences[:max_sentences]
        if not sentences:
            return []

        voice_to_use = self._pick_voice(text, language=language, voice=voice)
        logger.debug(
            "Synthesizing %d sentences with voice %s", len(sentences), voice_to_use
        )

        # Synthesize concurrently but bound the parallelism (the shared raw
        # connection serializes internally; this just prevents unbounded task
        # creation for long replies).
        sem = asyncio.Semaphore(4)

        total_sentences = len(sentences)

        async def _synth(index: int, sentence: str):
            async with sem:
                try:
                    spoken = clean_tts_text(normalize_for_speech(sentence))
                    if not spoken:
                        return {"text": sentence, "audio_data": None}
                    rate, pitch, volume = self._prosody_for(
                        sentence, index=index, total=total_sentences, speed=speed
                    )
                    audio = await self._synthesize_one(
                        sentence, spoken, voice_to_use, rate, pitch, volume
                    )
                    if not audio:
                        logger.warning("Empty TTS audio for sentence: %r", sentence[:40])
                        return {"text": sentence, "audio_data": None}
                    return {"text": sentence, "audio_data": audio}
                except Exception as e:
                    logger.error("Sentence TTS failed: %s", e)
                    return {"text": sentence, "audio_data": None}

        results = await asyncio.gather(*[_synth(i, s) for i, s in enumerate(sentences)])

        # Keep only sentences that produced audio; mark the rest so the
        # frontend can skip gracefully without breaking the queue.
        return [
            {
                "text": r["text"],
                "audio_data": (
                    base64_encode(r["audio_data"]) if r["audio_data"] else None
                ),
            }
            for r in results
        ]

    async def stream_sentences(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        max_sentences: int = 20,
        speed: Optional[float] = None,
    ):
        """
        Async generator that yields each sentence's audio IN ORDER as soon as
        it is ready — so the frontend can start playing sentence 1 while the
        later sentences are still being synthesized (real-time feel without
        ever cutting a sentence).

        Yields dicts: {"index": int, "text": str, "audio_data": base64-or-None}
        """
        all_sentences = split_into_sentences(text)[:max_sentences]
        if not all_sentences:
            return

        voice_to_use = self._pick_voice(text, language=language, voice=voice)
        # edge-tts is a shared public service that throttles under load —
        # 4 parallel sentences produced "No audio was received" errors.
        sem = asyncio.Semaphore(2)

        total_sentences = len(all_sentences)

        async def _synth(index: int, sentence: str):
            async with sem:
                try:
                    spoken = clean_tts_text(normalize_for_speech(sentence))
                    if not spoken:
                        return index, sentence, None
                    rate, pitch, volume = self._prosody_for(
                        sentence, index=index, total=total_sentences, speed=speed
                    )
                    audio = await self._synthesize_one(
                        sentence, spoken, voice_to_use, rate, pitch, volume
                    )
                    return index, sentence, audio or None
                except Exception as e:
                    logger.error("Streaming sentence TTS failed: %s", e)
                    return index, sentence, None

        # Launch all in parallel; collect into a buffer keyed by index and
        # yield strictly in order so playback is one continuous speaker.
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
    
    # ── Natural prosody (subtle, human-like rhythm) ─────────────────────────
    # The goal is a living counsellor, not a monotone TTS demo. Per sentence
    # we vary rate, pitch and volume a little based on the sentence type and
    # length:
    #   - Questions      : slight pitch rise  (sounds like a question)
    #   - Exclamations   : slight emphasis    (+pitch, +volume)
    #   - Short lines    : a touch faster     (brisk "Avunu...")
    #   - Long sentences : a touch slower     (clear, unhurried information)
    # All deltas are deliberately small — big swings are what make TTS sound
    # robotic or theatrical.
    _BASE_RATE = os.getenv("TTS_RATE", "+10%")  # slightly faster for natural phone pace
    _BASE_PITCH = os.getenv("TTS_PITCH", "+1Hz")  # slight warmth boost
    _BASE_VOLUME = os.getenv("TTS_VOLUME", "+2%")  # confident, clear voice

    @staticmethod
    def _parse_pct(value: str, default: int = 10) -> int:
        """Parse '+10%' -> 10, '-5%' -> -5, '0%' -> 0."""
        m = re.match(r"([+-]?\d+(?:\.\d+)?)%", value.strip())
        if not m:
            return default
        try:
            return int(float(m.group(1)))
        except ValueError:
            return default

    @staticmethod
    def _parse_hz(value: str, default: int = 0) -> int:
        """Parse '+2Hz' -> 2, '-3Hz' -> -3."""
        m = re.match(r"([+-]?\d+(?:\.\d+)?)\s*[Hh]z", value.strip())
        if not m:
            return default
        try:
            return int(float(m.group(1)))
        except ValueError:
            return default

    def _prosody_for(
        self,
        sentence: str,
        index: Optional[int] = None,
        total: Optional[int] = None,
        speed: Optional[float] = None,
    ) -> tuple:
        """
        Return (rate, pitch, volume) for ONE sentence.

        Naturalness rules — why this sounds like a person, not a wobbling TTS:
          * The persona baseline is STABLE. The agent's configured
            `voice_speed` drives the rate (1.0 = neutral, 1.15 = +15%), so a
            tenant's pace setting is actually audible and consistent instead
            of being replaced by per-sentence randomness.
          * Expression comes from INTENT (question / exclamation / trailing
            thought / short acknowledgement) and from POSITION in the reply
            (the opening ack is brisk and engaged, the closing question is
            allowed to land).
          * Punctuation drives the rhythm: clause-rich sentences are read a
            touch slower so the commas are audible as micro-pauses.
          * Jitter is tiny (±1). Wide randomness is exactly what makes TTS
            sound unstable — real people do not randomly change pace mid-answer.
        """
        # Per-agent speed wins over the env default when configured.
        base_rate = self._parse_pct(self._BASE_RATE)
        if speed is not None:
            try:
                base_rate = int(round((float(speed) - 1.0) * 100))
            except (TypeError, ValueError):
                pass
        base_pitch = self._parse_hz(self._BASE_PITCH)
        base_volume = self._parse_pct(self._BASE_VOLUME, default=0)
        s = sentence.strip()
        lower = s.lower()

        rate_delta = 0
        pitch_delta = 0
        volume_delta = 0

        # ── Intent: how the sentence ends ──
        if s.endswith("?"):
            pitch_delta += 3          # real question intonation
            rate_delta -= 1           # questions land better just slightly slower
        elif s.endswith("!"):
            pitch_delta += 2          # emphasis
            volume_delta += 3         # a touch louder
        elif s.endswith(("...", "…")):
            rate_delta -= 3           # thought trailing off
            pitch_delta -= 2
            volume_delta -= 3

        # ── Rhythm: commas are micro-pauses, not speed bumps ──
        if s.count(",") >= 2:
            rate_delta -= 1

        # ── Length ──
        words = len(s.split())
        if words <= 3:
            rate_delta += 2           # brisk, warm acknowledgement
            pitch_delta += 1
        elif len(s) > 140:
            rate_delta -= 2           # long info: calm and clear
            volume_delta -= 2
        elif len(s) > 90:
            rate_delta -= 1

        # ── Position in the reply ──
        if index == 0:
            rate_delta += 1           # engaged opening ack
        if index is not None and total and index == total - 1 and s.endswith("?"):
            rate_delta -= 1           # the closing question is not rushed

        # ── Warm acknowledgement openers feel bright, not flat ──
        warm_openers = (
            "yes", "yeah", "yep", "sure", "absolutely", "definitely", "of course",
            "got it", "okay", "right", "perfect", "great", "nice", "certainly",
            "avunu", "sare", "sari", "alage", "నమస్కారం", "సరే", "అవును", "అలాగే",
        )
        if lower.startswith(warm_openers):
            rate_delta += 1
            pitch_delta += 1

        # ── Thinking markers are unhurried ──
        if lower.startswith(("hmm", "well", "let me see", "ఊ")):
            rate_delta -= 1
            pitch_delta -= 1

        # ── Enthusiasm: genuinely positive news is delivered with energy ──
        if any(w in lower for w in (
            "great", "excellent", "congratulations", "absolutely", "definitely",
            "best", "top rank", "scholarship", "iit", "neet",
        )):
            rate_delta += 1
            pitch_delta += 1
            volume_delta += 1

        # ── Organic micro-jitter (±1) ──
        rate_delta += random.randint(-1, 1)
        pitch_delta += random.randint(-1, 1)
        volume_delta += random.randint(-1, 1)

        # Tight clamps: everything stays inside a warm, human range. Anything
        # wider starts to sound theatrical. The rate floor is deliberately
        # NEGATIVE so a tenant who configures a slower pace (voice_speed < 1.0)
        # actually hears it instead of being clamped back to normal speed.
        rate = max(-12, min(25, base_rate + rate_delta))
        pitch = max(-6, min(10, base_pitch + pitch_delta))
        volume = max(-3, min(8, base_volume + volume_delta))
        return f"{rate:+d}%", f"{pitch:+d}Hz", f"{volume:+d}%"

    # NOTE: inter-sentence breathing pauses are played by the CLIENT between
    # audio clips (the free Edge endpoint rejects <break>/<mstts:silence> and
    # returns zero audio for them). The pause lengths live next to the audio
    # queue that plays them, so the pacing is tuned where it is audible.

    async def _synthesize_one(
        self,
        sentence: str,
        spoken: str,
        voice: str,
        rate: str,
        pitch: str,
        volume: str,
    ) -> Optional[bytes]:
        """
        Synthesize ONE complete sentence as audio bytes.

        Uses edge_tts.Communicate directly. (The raw-SSML persistent-socket
        path was removed after live testing showed the free Edge endpoint
        intermittently drops raw-SSML turns after turn.start — every such
        turn silently degraded to this same Communicate path anyway, but
        only after wasting retries. Communicate opens a fresh connection
        per sentence and is empirically reliable.)
        """
        try:
            import edge_tts
            communicate = edge_tts.Communicate(
                spoken, voice, rate=rate, pitch=pitch, volume=volume
            )

            async def _collect() -> bytes:
                chunks = [
                    c["data"] async for c in communicate.stream()
                    if c["type"] == "audio"
                ]
                return b"".join(chunks)

            # Hard ceiling: a throttled edge-tts call must never stall a live
            # voice turn (a hung sentence previously blocked the whole reply).
            audio = await asyncio.wait_for(_collect(), timeout=20.0)
            return audio or None
        except asyncio.TimeoutError:
            logger.error("Plain TTS timed out after 20s (voice=%s)", voice)
            return None
        except Exception as e:
            logger.error("Plain TTS failed: %s", e)
            return None

    def _pick_voice(
        self,
        text: str,
        language: Optional[str] = None,
        voice: Optional[str] = None,
    ) -> str:
        """
        Choose the Edge-TTS voice for the given text.

        Priority:
          1. Script of the actual text (Telugu/Hindi/Tamil/Kannada/Malayalam
             characters -> the matching regional voice). This guarantees the
             voice can read the text even when the caller's language hint is
             wrong.
          2. Explicit `voice` argument.
          3. `language` hint mapped to a voice.
          4. Default configured voice.
        """
        if text:
            script_checks = [
                (r"[\u0C00-\u0C7F]", "Telugu", "te-IN"),
                (r"[\u0900-\u097F]", "Hindi", "hi-IN"),
                (r"[\u0B80-\u0BFF]", "Tamil", "ta-IN"),
                (r"[\u0C80-\u0CFF]", "Kannada", "kn-IN"),
                (r"[\u0D00-\u0D7F]", "Malayalam", "ml-IN"),
            ]
            for pattern, lang_name, locale in script_checks:
                if re.search(pattern, text):
                    # The tenant's own choice wins when that voice can already
                    # read this script (e.g. a Telugu MALE voice for Telugu) —
                    # otherwise the configured voice would be silently ignored.
                    if voice and voice.startswith(locale):
                        return voice
                    script_voice = self.voices.get(lang_name)
                    if script_voice:
                        logger.debug(
                            "Picked %s voice from script (%s)", script_voice, lang_name
                        )
                        return script_voice

        if voice:
            return voice
        if language and language in self.voices:
            return self.voices[language]
        return self.voice

    async def synthesize_pcm(
        self,
        text: str,
        voice: Optional[str] = None,
        language: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> Optional[bytes]:
        """
        Synthesize text to raw PCM16 @16 kHz mono (telephony path).

        Uses the PCM-configured persistent Edge socket so no MP3 decode is
        needed; the Twilio bridge converts PCM → 8 kHz µ-law directly.
        """
        if not text or not text.strip():
            return None
        try:
            spoken = clean_tts_text(normalize_for_speech(text))
            if not spoken:
                return None
            voice_to_use = self._pick_voice(text, language=language, voice=voice)
            xml_lang = _xml_lang_for(voice_to_use)
            escaped = html.escape(spoken, quote=False)
            # Same prosody engine as the web path so the phone call is the
            # same voice, pace and warmth as the browser preview (spec §12).
            rate, pitch, volume = self._prosody_for(text, index=0, total=1, speed=speed)
            ssml = (
                "<speak version='1.0' "
                "xmlns='http://www.w3.org/2001/10/synthesis' "
                f"xml:lang='{xml_lang}'>"
                f"<voice name='{voice_to_use}'>"
                f"<prosody pitch='{pitch}' rate='{rate}' volume='{volume}'>"
                f"{escaped}"
                "</prosody>"
                "</voice>"
                "</speak>"
            )
            from app.tts.raw_ssml import get_raw_synth_pcm
            return await asyncio.wait_for(
                get_raw_synth_pcm().synthesize(ssml), timeout=20.0
            )
        except Exception as e:
            logger.error("PCM synthesis failed: %s", e)
            return None

    async def get_available_voices(self) -> list[str]:
        """Get list of available voices."""
        try:
            import edge_tts
            loop = asyncio.get_event_loop()
            voices = await loop.run_in_executor(
                None,
                lambda: [v["Name"] for v in edge_tts.list_voices()]
            )
            return voices
        except Exception as e:
            logger.error(f"Error getting voices: {e}")
            return []


# Global TTS instance
_tts_service: Optional[EdgeTTSService] = None


def get_tts_service() -> EdgeTTSService:
    """Get or create global TTS service instance."""
    global _tts_service
    if _tts_service is None:
        _tts_service = EdgeTTSService()
    return _tts_service
