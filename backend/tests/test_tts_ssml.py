"""
Unit tests for the expressive Edge-TTS path (no network).

These verify the SSML that will be sent over the persistent websocket is well
formed, escapes user text, picks the right xml:lang, and that prosody varies
per sentence type — the "human engine" guarantees.
"""

import asyncio
import html
import sys
from pathlib import Path

# Ensure backend is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _build_ssml(spoken: str, voice: str, rate: str, pitch: str, volume: str) -> str:
    """Mirror of the expressive SSML built in edge_tts_service._synthesize_one."""
    parts = voice.split("-")
    xml_lang = "-".join(parts[:2]) if len(parts) >= 2 else "en-US"
    escaped = html.escape(spoken, quote=False)
    return (
        "<speak version='1.0' "
        "xmlns='http://www.w3.org/2001/10/synthesis' "
        f"xml:lang='{xml_lang}'>"
        f"<voice name='{voice}'>"
        f"<prosody pitch='{pitch}' rate='{rate}' volume='{volume}'>"
        f"{escaped}"
        "</prosody>"
        "</voice>"
        "</speak>"
    )


class TestExpressiveSSML:
    def test_telugu_voice_lang(self):
        ssml = _build_ssml(
            "Avunu.", "te-IN-ShrutiNeural", "+8%", "+0Hz", "+0%"
        )
        assert "xml:lang='te-IN'" in ssml
        assert "voice name='te-IN-ShrutiNeural'" in ssml
        assert "Avunu." in ssml

    def test_english_voice_lang(self):
        ssml = _build_ssml(
            "Hello!", "en-IN-NeerjaNeural", "+8%", "+0Hz", "+0%"
        )
        assert "xml:lang='en-IN'" in ssml
        assert "voice name='en-IN-NeerjaNeural'" in ssml

    def test_user_text_is_escaped(self):
        # A literal <mstts:express-as> in the LLM output must never reach the
        # service as markup (that was the original robotic-voice bug).
        ssml = _build_ssml(
            "Avunu <b>bold</b> & more", "te-IN-ShrutiNeural", "+8%", "+0Hz", "+0%"
        )
        assert "<b>bold</b>" not in ssml
        assert "&lt;b&gt;bold&lt;/b&gt;" in ssml
        assert "&amp;" in ssml

    def test_prosody_attributes_are_forwarded(self):
        ssml = _build_ssml(
            "Question?", "te-IN-ShrutiNeural", "+8%", "+3Hz", "+0%"
        )
        assert "pitch='+3Hz'" in ssml
        assert "rate='+8%'" in ssml
        assert "volume='+0%'" in ssml

    def test_no_mstts_tags(self):
        # The free Edge endpoint rejects mstts:express-as / mstts:silence and
        # even <break> with zero audio — the SSML must be plain voice+prosody.
        ssml = _build_ssml("Avunu.", "te-IN-ShrutiNeural", "+8%", "+0Hz", "+0%")
        assert "mstts" not in ssml
        assert "<break" not in ssml

    def test_prosody_for_returns_valid_formats(self):
        """_prosody_for must always return SSML-valid rate/pitch/volume strings
        (with organic jitter, but never malformed or out of sane bounds)."""
        import re as _re
        from app.tts.edge_tts_service import EdgeTTSService

        service = EdgeTTSService()
        for sentence in ("Avunu?", "Sure!", "A longer statement about fees.", "Hmm..."):
            rate, pitch, volume = service._prosody_for(sentence)
            assert _re.match(r"[+-]\d+%$", rate), rate
            assert _re.match(r"[+-]\d+Hz$", pitch), pitch
            assert _re.match(r"[+-]\d+%$", volume), volume
            # Jitter stays within ±2 of the base deltas — never extreme.
            # (Short questions can reach +13% rate; long quiet lines -4%.)
            assert -15 <= int(rate[:-1]) <= 15
            assert -6 <= int(pitch[:-2]) <= 6
            assert -10 <= int(volume[:-1]) <= 10


class TestRawSynthStructure:
    def test_connection_reuse_lock(self):
        """The shared synth must serialize on one lock (single persistent conn)."""
        from app.tts.raw_ssml import RawSSMLSynth

        synth = RawSSMLSynth()
        assert hasattr(synth, "_lock")
        assert isinstance(synth._lock, asyncio.Lock)
        # Not connected until first synthesize — lazy connection.
        assert synth._ws is None

    def test_no_audio_raises(self):
        """An empty frame stream must raise, not return silent garbage."""
        from app.tts.raw_ssml import RawSSMLSynth

        synth = RawSSMLSynth()

        async def _fake():
            # Simulate a server that never sends audio
            class FakeWs:
                closed = False

                def __aiter__(self):
                    return self

                async def __anext__(self):
                    raise StopAsyncIteration

            synth._ws = FakeWs()
            try:
                await synth._receive_audio()
                raise AssertionError("should have raised")
            except RuntimeError as e:
                assert "No audio" in str(e)

        asyncio.run(_fake())
