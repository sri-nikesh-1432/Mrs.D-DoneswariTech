"""
Audio streaming and buffering for real-time call audio.
"""

import asyncio
import queue
from typing import Optional
from dataclasses import dataclass
import logging

from app.logs.logger import get_logger

logger = get_logger(__name__)


@dataclass
class AudioChunk:
    """Audio chunk with metadata."""
    data: bytes
    timestamp: float
    sample_rate: int = 8000
    channels: int = 1


class AudioBuffer:
    """Circular buffer for audio chunks."""
    
    def __init__(self, max_size: int = 100):
        self.buffer = queue.Queue(maxsize=max_size)
        self.max_size = max_size
    
    def put(self, chunk: AudioChunk):
        """Add chunk to buffer, dropping oldest if full."""
        try:
            self.buffer.put_nowait(chunk)
        except queue.Full:
            # Drop oldest chunk
            try:
                self.buffer.get_nowait()
                self.buffer.put_nowait(chunk)
            except queue.Empty:
                pass
    
    def get(self, timeout: float = 0.1) -> Optional[AudioChunk]:
        """Get chunk from buffer."""
        try:
            return self.buffer.get(timeout=timeout)
        except queue.Empty:
            return None
    
    def get_all(self) -> list[AudioChunk]:
        """Get all chunks from buffer."""
        chunks = []
        while not self.buffer.empty():
            try:
                chunks.append(self.buffer.get_nowait())
            except queue.Empty:
                break
        return chunks
    
    def clear(self):
        """Clear buffer."""
        while not self.buffer.empty():
            try:
                self.buffer.get_nowait()
            except queue.Empty:
                break
    
    def size(self) -> int:
        """Get current buffer size."""
        return self.buffer.qsize()


class AudioStream:
    """Manages audio streaming for a call."""
    
    def __init__(self, call_id: str):
        self.call_id = call_id
        self.input_buffer = AudioBuffer(max_size=200)
        self.output_buffer = AudioBuffer(max_size=200)
        self.is_streaming = False
        self.input_task: Optional[asyncio.Task] = None
        self.output_task: Optional[asyncio.Task] = None
    
    async def start_streaming(self):
        """Start audio streaming."""
        if self.is_streaming:
            return
        
        self.is_streaming = True
        logger.info(f"Started audio streaming for call {self.call_id}")
    
    def add_input_audio(self, data: bytes, sample_rate: int = 8000):
        """Add incoming audio from caller."""
        chunk = AudioChunk(
            data=data,
            timestamp=asyncio.get_event_loop().time(),
            sample_rate=sample_rate
        )
        self.input_buffer.put(chunk)
    
    def add_output_audio(self, data: bytes, sample_rate: int = 8000):
        """Add outgoing audio to caller."""
        chunk = AudioChunk(
            data=data,
            timestamp=asyncio.get_event_loop().time(),
            sample_rate=sample_rate
        )
        self.output_buffer.put(chunk)
    
    def get_input_audio(self, timeout: float = 0.1) -> Optional[AudioChunk]:
        """Get next input audio chunk."""
        return self.input_buffer.get(timeout)
    
    def get_output_audio(self, timeout: float = 0.1) -> Optional[AudioChunk]:
        """Get next output audio chunk."""
        return self.output_buffer.get(timeout)
    
    async def stop_streaming(self):
        """Stop audio streaming."""
        self.is_streaming = False
        self.input_buffer.clear()
        self.output_buffer.clear()
        
        if self.input_task:
            self.input_task.cancel()
        if self.output_task:
            self.output_task.cancel()
        
        logger.info(f"Stopped audio streaming for call {self.call_id}")
