"""
Raw SSML websocket synthesis for Edge TTS.

WHY THIS EXISTS
---------------
`edge_tts.Communicate` escapes EVERY input string (html-escape) and wraps it in
its own fixed template (`mkssml`). Genuine <mstts:express-as> / <mstts:silence>
markup can therefore NEVER reach the service through Communicate - the escaped
tags are read ALOUD as literal text ("speak version one point zero xmlns http
colon slash slash ..."). That produces 20-40 seconds of garbage per sentence -
the "robotic" Mrs. D voice and the mysterious 16s greetings all along.

This module speaks the Edge websocket protocol directly (the same protocol
edge-tts uses internally), so we can send TRUE expressive SSML, and it keeps ONE
persistent websocket across sentences so realtime latency stays low instead of
re-opening a connection per sentence.
"""

import asyncio
from typing import Optional

import aiohttp

from edge_tts.communicate import (
    _SSL_CTX,
    connect_id,
    date_to_string,
    get_headers_and_data,
    ssml_headers_plus_data,
)
from edge_tts.constants import SEC_MS_GEC_VERSION, WSS_HEADERS, WSS_URL
from edge_tts.drm import DRM


class RawSSMLSynth:
    """
    One persistent Edge websocket. Send a raw SSML fragment, get MP3 bytes back.

    The socket stays open across fragments (speech.config is sent once), and is
    transparently reconnected if the server drops it or a request fails.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None

    # -- connection lifecycle ----------------------------------------------
    async def _close_ws(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        if self._session is not None:
            try:
                await self._session.close()
            except Exception:
                pass
            self._session = None

    async def _connect(self) -> None:
        """Open the websocket and send the one-time speech.config handshake."""
        await self._close_ws()
        self._session = aiohttp.ClientSession(
            trust_env=True,
            timeout=aiohttp.ClientTimeout(
                total=None, connect=None, sock_connect=10, sock_read=60
            ),
        )
        url = (
            f"{WSS_URL}&ConnectionId={connect_id()}"
            f"&Sec-MS-GEC={DRM.generate_sec_ms_gec()}"
            f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
        )
        self._ws = await self._session.ws_connect(
            url,
            compress=15,
            headers=DRM.headers_with_muid(WSS_HEADERS),
            ssl=_SSL_CTX,
        )
        await self._ws.send_str(
            f"X-Timestamp:{date_to_string()}\r\n"
            "Content-Type:application/json; charset=utf-8\r\n"
            "Path:speech.config\r\n\r\n"
            '{"context":{"synthesis":{"audio":{"metadataoptions":'
            '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
            '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
        )

    # -- frame reader ------------------------------------------------------
    async def _receive_audio(self) -> bytes:
        """Read frames until turn.end; return concatenated MP3 audio bytes."""
        audio = bytearray()
        audio_was_received = False
        async for received in self._ws:  # type: ignore[union-attr]
            if received.type == aiohttp.WSMsgType.TEXT:
                encoded = received.data.encode("utf-8")
                parameters, _ = get_headers_and_data(
                    encoded, encoded.find(b"\r\n\r\n")
                )
                path = parameters.get(b"Path", None)
                if path == b"audio.metadata":
                    continue
                if path == b"turn.end":
                    break
                if path not in (b"response", b"turn.start"):
                    raise RuntimeError(f"Unknown text path: {path!r}")
            elif received.type == aiohttp.WSMsgType.BINARY:
                if len(received.data) < 2:
                    raise RuntimeError("Binary message missing header length")
                header_length = int.from_bytes(received.data[:2], "big")
                parameters, data = get_headers_and_data(
                    received.data, header_length
                )
                if parameters.get(b"Path") != b"audio":
                    continue
                content_type = parameters.get(b"Content-Type", None)
                if content_type not in (b"audio/mpeg", None):
                    raise RuntimeError(
                        f"Unexpected content type: {content_type!r}"
                    )
                if data:
                    audio_was_received = True
                    audio += data
            elif received.type == aiohttp.WSMsgType.ERROR:
                raise RuntimeError(f"WebSocket error: {received.data}")
        if not audio_was_received:
            raise RuntimeError("No audio received")
        return bytes(audio)

    # -- public API --------------------------------------------------------
    async def synthesize(self, ssml: str) -> bytes:
        """Send one raw SSML fragment; return MP3 audio bytes.

        Reconnects transparently once if the persistent connection is stale.
        """
        async with self._lock:
            if self._ws is None or self._ws.closed:
                await self._connect()
            try:
                await self._ws.send_str(
                    ssml_headers_plus_data(
                        connect_id(), date_to_string(), ssml
                    )
                )
                return await self._receive_audio()
            except (
                aiohttp.ClientResponseError,
                aiohttp.ClientError,
                ConnectionError,
                RuntimeError,
            ):
                # Connection likely stale -> reconnect once and retry.
                await self._close_ws()
                await self._connect()
                try:
                    await self._ws.send_str(
                        ssml_headers_plus_data(
                            connect_id(), date_to_string(), ssml
                        )
                    )
                    return await self._receive_audio()
                except Exception:
                    await self._close_ws()
                    raise

    async def close(self) -> None:
        """Close the persistent connection (call on app shutdown)."""
        async with self._lock:
            await self._close_ws()


# Shared singleton so every EdgeTTSService instance reuses ONE persistent
# connection (no reconnect per sentence = lower realtime latency).
_raw_synth: Optional[RawSSMLSynth] = None


def get_raw_synth() -> RawSSMLSynth:
    """Get or create the shared persistent raw-SSML synthesizer."""
    global _raw_synth
    if _raw_synth is None:
        _raw_synth = RawSSMLSynth()
    return _raw_synth


async def close_raw_synth() -> None:
    """Close the shared synthesizer (call on app shutdown)."""
    global _raw_synth
    if _raw_synth is not None:
        await _raw_synth.close()
        _raw_synth = None
