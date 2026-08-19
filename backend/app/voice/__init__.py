"""
Voice pipeline module for Mrs. D AI Admission Campaign Platform.
"""

from .voice_service import VoiceService
from .voice_ws import router as voice_ws_router

__all__ = ["VoiceService", "voice_ws_router"]
