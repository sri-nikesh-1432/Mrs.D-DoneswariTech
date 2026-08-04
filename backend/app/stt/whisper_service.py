"""
Whisper Speech-to-Text service.
Transcribes audio from incoming calls.
"""

import asyncio
import os
from typing import Optional
import logging

from app.logs.logger import get_logger

logger = get_logger(__name__)


class WhisperSTT:
    """Whisper-based speech-to-text service."""
    
    def __init__(self, model_size: str = "base"):
        self.model_size = model_size
        self.model = None
        self.is_loaded = False
        
        # Whisper configuration
        self.language = os.getenv("WHISPER_LANGUAGE", "en")
        self.device = os.getenv("WHISPER_DEVICE", "cpu")
    
    async def load_model(self):
        """Load Whisper model."""
        if self.is_loaded:
            return
        
        try:
            import whisper
            logger.info(f"Loading Whisper model: {self.model_size}")
            
            # Load model in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            self.model = await loop.run_in_executor(
                None,
                lambda: whisper.load_model(self.model_size, device=self.device)
            )
            
            self.is_loaded = True
            logger.info("Whisper model loaded successfully")
        except ImportError:
            logger.error("Whisper not installed. Install with: pip install openai-whisper")
            raise
        except Exception as e:
            logger.error(f"Error loading Whisper model: {e}")
            raise
    
    async def transcribe(
        self,
        audio_data: bytes,
        sample_rate: int = 16000
    ) -> Optional[str]:
        """
        Transcribe audio data to text.
        
        Args:
            audio_data: Raw audio bytes (PCM 16-bit)
            sample_rate: Audio sample rate (default 16000 for Whisper)
        
        Returns:
            Transcribed text or None if transcription fails
        """
        if not self.is_loaded:
            await self.load_model()
        
        try:
            import numpy as np
            
            # Convert bytes to numpy array
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            
            # Convert to float32 and normalize
            audio_array = audio_array.astype(np.float32) / 32768.0
            
            # Transcribe in thread pool
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: self.model.transcribe(
                    audio_array,
                    language=self.language,
                    fp16=False if self.device == "cpu" else True
                )
            )
            
            text = result["text"].strip()
            logger.debug(f"Transcribed: {text}")
            return text
            
        except Exception as e:
            logger.error(f"Error transcribing audio: {e}")
            return None
    
    async def transcribe_stream(
        self,
        audio_chunks: list[bytes],
        sample_rate: int = 16000
    ) -> Optional[str]:
        """
        Transcribe stream of audio chunks.
        
        Args:
            audio_chunks: List of audio chunks
            sample_rate: Audio sample rate
        
        Returns:
            Transcribed text or None if transcription fails
        """
        if not audio_chunks:
            return None
        
        # Concatenate all chunks
        import numpy as np
        combined = b"".join(audio_chunks)
        return await self.transcribe(combined, sample_rate)


# Global STT instance
_stt_service: Optional[WhisperSTT] = None


def get_stt_service() -> WhisperSTT:
    """Get or create global STT service instance."""
    global _stt_service
    if _stt_service is None:
        _stt_service = WhisperSTT()
    return _stt_service
