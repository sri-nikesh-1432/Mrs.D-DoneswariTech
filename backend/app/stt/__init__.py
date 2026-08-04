"""
Speech-to-Text module for Mrs. D AI Voice Receptionist Platform.
Uses Whisper for audio transcription.
"""

from .whisper_service import WhisperSTT

__all__ = ["WhisperSTT"]
