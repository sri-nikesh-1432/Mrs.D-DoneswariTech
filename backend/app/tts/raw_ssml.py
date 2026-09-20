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
    One persistent Edge websocket. Send a raw SSML fragment, get audio bytes back.

    The socket stays open across fragments (speech.config is sent once), and is
    transparently reconnected if the server drops it or a request fails.

    A background keepalive task sends an empty speech.config every 15s so the
    socket never goes stale — without it the first synthesis after an idle gap
    pays a full reconnect (~400-600ms extra TTFA).

    output_format selects the Edge audio format:
      - "audio-24khz-48kbitrate-mono-mp3" (default) for browser playback
      - "raw-16khz-16bit-mono-pcm" for telephony (Twilio µ-law conversion)
    """

    KEEPALIVE_INTERVAL = 15

    def __init__(self, output_format: str = "audio-24khz-48kbitrate-mono-mp3") -> None:
        self._output_format = output_format
        self._lock = asyncio.Lock()
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._keepalive_task: Optional[asyncio.Task] = None

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
            f'"outputFormat":"{self._output_format}"}}}}\r\n'
        )
        self._ensure_keepalive()

    # -- keepalive -----------------------------------------------------------
    def _ensure_keepalive(self) -> None:
        """Start (or restart) the background ping loop that keeps the Edge
        socket hot. A stale socket costs a full reconnect on the next turn."""
        if self._keepalive_task is not None and not self._keepalive_task.done():
            return
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())

    async def _keepalive_loop(self) -> None:
        while True:
            await asyncio.sleep(self.KEEPALIVE_INTERVAL)
            if self._ws is None or self._ws.closed:
                continue
            try:
                await self._ws.send_str(
                    f"X-Timestamp:{date_to_string()}\r\n"
                    "Content-Type:application/json; charset=utf-8\r\n"
                    "Path:speech.config\r\n\r\n"
                    "{}\r\n"
                )
            except Exception:
                # Socket died between turns — close it so the next synthesize()
                # reconnects cleanly instead of timing out on a dead socket.
                await self._close_ws()

    # -- frame reader ------------------------------------------------------
    # A silently-dead (half-open) websocket blocks the frame iterator forever
    # — that hung every greeting/turn until the service restarted. Every
    # network read below runs under a hard timeout so a stale connection
    # raises instead of stalling a live call.
    RECV_TIMEOUT = 15.0   # per-frame ceiling (frames normally arrive <1s apart)
    TURN_TIMEOUT = 30.0   # whole-synthesis ceiling
    MAX_ATTEMPTS = 3      # warm socket + 2 fresh-connection retries
    RETRY_BACKOFF = 0.4   # seconds; jitterless small backoff between attempts

    async def _receive_audio(self) -> bytes:
        """Read frames until turn.end; return concatenated MP3 audio bytes."""
        audio = bytearray()
        audio_was_received = False

        async def _next_frame():
            # aiohttp's async iterator has no per-recv timeout of its own.
            # StopAsyncIteration (stream closed) is normalized to None so the
            # "No audio received" contract below still holds.
            anext_fn = self._ws.__anext__
            try:
                return await asyncio.wait_for(anext_fn(), timeout=self.RECV_TIMEOUT)
            except StopAsyncIteration:
                return None

        while True:
            received = await _next_frame()
            if received is None:
                break
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
    async def synthesize_fast(self, ssml: str, timeout: float = 6.0) -> Optional[bytes]:
        """ONE quick attempt over the warm persistent socket.

        This is the low-latency path for live speech: no retry back-offs, no
        per-sentence TLS+WS handshake. A stale socket or a throttled Edge
        response returns None quickly instead of stalling a voice turn, so the
        caller can fall back to a fresh `edge_tts.Communicate` connection.
        """
        async with self._lock:
            if self._ws is None or self._ws.closed:
                await self._connect()
            try:
                await asyncio.wait_for(
                    self._ws.send_str(
                        ssml_headers_plus_data(connect_id(), date_to_string(), ssml)
                    ),
                    timeout=self.RECV_TIMEOUT,
                )
                return await asyncio.wait_for(self._receive_audio(), timeout=timeout)
            except Exception:
                # The persistent socket is suspect — discard it so the next
                # call reconnects cleanly.
                await self._close_ws()
                return None

    async def synthesize(self, ssml: str) -> bytes:
        """Send one raw SSML fragment; return MP3 audio bytes.

        Reconnects transparently once if the persistent connection is stale.
        """
        async with self._lock:
            last_err: Optional[Exception] = None
            for attempt in range(self.MAX_ATTEMPTS):
                try:
                    # Prefer the warm persistent socket; if it is stale the
                    # send/receive below raises and we fall through to a FRESH
                    # connection (the same path edge_tts.Communicate uses,
                    # which is far more reliable against Edge's flaky
                    # "turn.start then close" throttling behaviour).
                    if self._ws is None or self._ws.closed:
                        await self._connect()
                    await asyncio.wait_for(
                        self._ws.send_str(
                            ssml_headers_plus_data(
                                connect_id(), date_to_string(), ssml
                            )
                        ),
                        timeout=self.RECV_TIMEOUT,
                    )
                    return await asyncio.wait_for(
                        self._receive_audio(), timeout=self.TURN_TIMEOUT
                    )
                except (
                    asyncio.TimeoutError,
                    aiohttp.ClientResponseError,
                    aiohttp.ClientError,
                    ConnectionError,
                    RuntimeError,
                ) as e:
                    last_err = e
                    # The persistent socket is suspect — discard it entirely.
                    # The retry opens a brand-new TLS+WS connection, which
                    # empirically succeeds where the reused one fails.
                    await self._close_ws()
                    if attempt + 1 < self.MAX_ATTEMPTS:
                        await asyncio.sleep(self.RETRY_BACKOFF * (attempt + 1))
            assert last_err is not None
            raise last_err

    async def close(self) -> None:
        """Close the persistent connection (call on app shutdown)."""
        async with self._lock:
            await self._close_ws()


# Shared singleton so every EdgeTTSService instance reuses ONE persistent
# connection (no reconnect per sentence = lower realtime latency).
_raw_synth: Optional[RawSSMLSynth] = None
_raw_synth_pcm: Optional[RawSSMLSynth] = None


def get_raw_synth() -> RawSSMLSynth:
    """Get or create the shared persistent raw-SSML synthesizer (MP3 out)."""
    global _raw_synth
    if _raw_synth is None:
        _raw_synth = RawSSMLSynth(output_format="audio-24khz-48kbitrate-mono-mp3")
    return _raw_synth


def get_raw_synth_pcm() -> RawSSMLSynth:
    """Get or create the shared PCM synthesizer (raw 16 kHz 16-bit mono PCM).
    Used by the telephony bridge, which converts PCM to µ-law for the phone."""
    global _raw_synth_pcm
    if _raw_synth_pcm is None:
        _raw_synth_pcm = RawSSMLSynth(output_format="raw-16khz-16bit-mono-pcm")
    return _raw_synth_pcm


async def close_raw_synth() -> None:
    """Close the shared synthesizers (call on app shutdown)."""
    global _raw_synth, _raw_synth_pcm
    if _raw_synth is not None:
        if _raw_synth._keepalive_task is not None:
            _raw_synth._keepalive_task.cancel()
        await _raw_synth.close()
        _raw_synth = None
    if _raw_synth_pcm is not None:
        if _raw_synth_pcm._keepalive_task is not None:
            _raw_synth_pcm._keepalive_task.cancel()
        await _raw_synth_pcm.close()
        _raw_synth_pcm = None
