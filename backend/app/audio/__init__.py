"""
Audio module for Mrs. D AI Voice Receptionist Platform.
Handles audio streaming, buffering, and processing.
"""

from .audio_stream import AudioStream, AudioBuffer
from .audio_processor import AudioProcessor

__all__ = ["AudioStream", "AudioBuffer", "AudioProcessor"]
