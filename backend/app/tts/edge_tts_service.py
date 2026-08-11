"""
Edge-TTS Text-to-Speech service.
Generates audio from AI responses.
"""

import asyncio
import base64
import html
import os
import re
from typing import Optional
import logging

from app.logs.logger import get_logger
from app.roman_telugu import normalize_for_speech, split_into_sentences

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
        # Indian neural voices for different languages
        self.voices = {
            "English": "en-IN-NeerjaNeural",  # Indian English female
            "English-Alt": "en-IN-PrabhaNeural",  # Indian English female (alternative)
            "Telugu": "te-IN-ShrutiNeural",    # Telugu female
            "Hindi": "hi-IN-SwaraNeural",      # Hindi female
            "Hindi-Alt": "hi-IN-MeeraNeural",  # Hindi female (alternative)
            "Tamil": "ta-IN-PallaviNeural",    # Tamil female
            "Kannada": "kn-IN-SapnaNeural",    # Kannada female
            "Malayalam": "ml-IN-SobhanaNeural", # Malayalam female
        }
        self.voice = os.getenv("TTS_VOICE", "te-IN-ShrutiNeural")
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
        language: Optional[str] = None
    ) -> Optional[bytes]:
        """
        Synthesize text to audio.
        
        Args:
            text: Text to synthesize
            voice: Voice to use (default from env or language)
            language: Language for automatic voice selection
        
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
            # being read digit-by-digit.
            spoken_text = normalize_for_speech(text)

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
            
            # Create communicate object
            communicate = edge_tts.Communicate(
                spoken_text,
                voice_to_use,
                rate=self.rate,
                pitch=self.pitch
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

        # Synthesize concurrently but bound the parallelism (edge-tts handles
        # a handful of parallel connections fine; unbounded could overwhelm).
        sem = asyncio.Semaphore(4)

        async def _synth(sentence: str):
            async with sem:
                try:
                    spoken = normalize_for_speech(sentence)
                    rate, pitch = self._prosody_for(sentence)
                    audio = await self._synthesize_one(
                        spoken, voice_to_use, rate, pitch
                    )
                    if not audio:
                        logger.warning("Empty TTS audio for sentence: %r", sentence[:40])
                        return {"text": sentence, "audio_data": None}
                    return {"text": sentence, "audio_data": audio}
                except Exception as e:
                    logger.error("Sentence TTS failed: %s", e)
                    return {"text": sentence, "audio_data": None}

        results = await asyncio.gather(*[_synth(s) for s in sentences])

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
        sem = asyncio.Semaphore(4)

        async def _synth(index: int, sentence: str):
            async with sem:
                try:
                    spoken = normalize_for_speech(sentence)
                    rate, pitch = self._prosody_for(sentence)
                    audio = await self._synthesize_one(
                        spoken, voice_to_use, rate, pitch
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
    # we vary pitch and rate a little based on the sentence type and length:
    #   - Questions      : slight pitch rise  (sounds like a question)
    #   - Exclamations   : slight emphasis    (+pitch)
    #   - Short lines    : a touch faster     (brisk "Avunu...")
    #   - Long sentences : a touch slower     (clear, unhurried information)
    # All deltas are deliberately small — big swings are what make TTS sound
    # robotic or theatrical.
    _BASE_RATE = os.getenv("TTS_RATE", "+8%")
    _BASE_PITCH = os.getenv("TTS_PITCH", "+0Hz")

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

    def _prosody_for(self, sentence: str) -> tuple:
        """
        Return (rate, pitch) for a single sentence so the whole reply does not
        sound equally timed and pitched.
        """
        base_rate = self._parse_pct(self._BASE_RATE)
        base_pitch = self._parse_hz(self._BASE_PITCH)
        s = sentence.strip()

        rate_delta = 0
        pitch_delta = 0

        if s.endswith("?"):
            pitch_delta += 3          # gentle question rise
        elif s.endswith("!"):
            pitch_delta += 2          # gentle emphasis

        length = len(s)
        if length < 20:
            rate_delta += 3           # short, brisk acknowledgement
        elif length > 130:
            rate_delta -= 2           # long sentence: calm, clear

        rate = base_rate + rate_delta
        pitch = base_pitch + pitch_delta
        return f"{rate:+d}%", f"{pitch:+d}Hz"

    async def _synthesize_one(
        self, spoken: str, voice: str, rate: str, pitch: str
    ) -> Optional[bytes]:
        """
        Synthesize ONE complete sentence as audio bytes.

        Tries SSML with an expressive style first — `mstts:express-as
        style="friendly"` makes the neural voice sound like a warm person
        talking (the single biggest fix for the "robotic TTS" feel). Falls
        back to plain synthesis for voices that reject express-as, so other
        languages are never broken by the upgrade.
        """
        try:
            import edge_tts
            xml_lang = _xml_lang_for(voice)
            escaped = html.escape(spoken, quote=False)
            ssml = (
                '<speak version="1.0" '
                'xmlns="http://www.w3.org/2001/10/synthesis" '
                'xmlns:mstts="http://www.w3.org/2001/mstts" '
                f'xml:lang="{xml_lang}">'
                '<mstts:express-as style="friendly">'
                f'<prosody rate="{rate}" pitch="{pitch}">{escaped}</prosody>'
                "</mstts:express-as></speak>"
            )
            communicate = edge_tts.Communicate(ssml, voice, rate="+0%", pitch="+0Hz")
            chunks = [
                c["data"] async for c in communicate.stream()
                if c["type"] == "audio"
            ]
            audio = b"".join(chunks)
            if audio:
                return audio
            logger.debug("Express-as produced no audio; falling back to plain")
        except Exception as e:
            logger.debug("Express-as synthesis failed (%s); falling back to plain", e)

        # Plain fallback (voices that do not support mstts:express-as)
        try:
            import edge_tts
            communicate = edge_tts.Communicate(spoken, voice, rate=rate, pitch=pitch)
            chunks = [
                c["data"] async for c in communicate.stream()
                if c["type"] == "audio"
            ]
            return b"".join(chunks) or None
        except Exception as e:
            logger.error("Plain TTS synthesis failed: %s", e)
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
                (r"[\u0C00-\u0C7F]", "Telugu"),
                (r"[\u0900-\u097F]", "Hindi"),
                (r"[\u0B80-\u0BFF]", "Tamil"),
                (r"[\u0C80-\u0CFF]", "Kannada"),
                (r"[\u0D00-\u0D7F]", "Malayalam"),
            ]
            for pattern, lang_name in script_checks:
                if re.search(pattern, text):
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
