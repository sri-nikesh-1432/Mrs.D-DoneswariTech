"""
Audio processing utilities - silence detection, VAD, format conversion.
"""

import numpy as np
from typing import Optional
import logging

from app.logs.logger import get_logger

logger = get_logger(__name__)


class AudioProcessor:
    """Processes audio for silence detection and VAD."""
    
    def __init__(self, sample_rate: int = 8000, silence_threshold: float = 0.01):
        self.sample_rate = sample_rate
        self.silence_threshold = silence_threshold
        self.silence_duration_ms = 2000  # 2 seconds of silence
        self.last_audio_level = 0.0
    
    def calculate_audio_level(self, audio_data: bytes) -> float:
        """Calculate RMS audio level."""
        try:
            # Convert bytes to numpy array
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            
            # Calculate RMS
            rms = np.sqrt(np.mean(audio_array.astype(np.float32) ** 2))
            
            # Normalize to 0-1 range (assuming 16-bit audio)
            normalized = rms / 32768.0
            
            self.last_audio_level = normalized
            return normalized
        except Exception as e:
            logger.error(f"Error calculating audio level: {e}")
            return 0.0
    
    def is_silence(self, audio_data: bytes) -> bool:
        """Detect if audio chunk is silence."""
        audio_level = self.calculate_audio_level(audio_data)
        return audio_level < self.silence_threshold
    
    def detect_speech_end(self, audio_chunks: list[bytes]) -> bool:
        """
        Detect if speech has ended based on silence duration.
        Returns True if silence duration exceeds threshold.
        """
        silence_duration = 0
        chunk_duration_ms = len(audio_chunks[0]) / (self.sample_rate * 2) * 1000 if audio_chunks else 0
        
        for chunk in audio_chunks:
            if self.is_silence(chunk):
                silence_duration += chunk_duration_ms
                if silence_duration >= self.silence_duration_ms:
                    return True
            else:
                silence_duration = 0
        
        return False
    
    def convert_sample_rate(self, audio_data: bytes, from_rate: int, to_rate: int) -> bytes:
        """Convert audio sample rate."""
        if from_rate == to_rate:
            return audio_data
        
        # Simple resampling using linear interpolation
        # For production, use scipy.signal.resample or similar
        try:
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            ratio = to_rate / from_rate
            new_length = int(len(audio_array) * ratio)
            resampled = np.interp(
                np.linspace(0, len(audio_array), new_length),
                np.arange(len(audio_array)),
                audio_array.astype(np.float32)
            ).astype(np.int16)
            return resampled.tobytes()
        except Exception as e:
            logger.error(f"Error converting sample rate: {e}")
            return audio_data
    
    def mix_audio(self, audio1: bytes, audio2: bytes) -> bytes:
        """Mix two audio streams."""
        try:
            arr1 = np.frombuffer(audio1, dtype=np.int16)
            arr2 = np.frombuffer(audio2, dtype=np.int16)
            
            # Pad shorter array
            if len(arr1) < len(arr2):
                arr1 = np.pad(arr1, (0, len(arr2) - len(arr1)), 'constant')
            elif len(arr2) < len(arr1):
                arr2 = np.pad(arr2, (0, len(arr1) - len(arr2)), 'constant')
            
            # Mix with clipping prevention
            mixed = np.clip(arr1.astype(np.int32) + arr2.astype(np.int32), -32768, 32767).astype(np.int16)
            return mixed.tobytes()
        except Exception as e:
            logger.error(f"Error mixing audio: {e}")
            return audio1
