"""
Edge-TTS Text-to-Speech service.
Generates audio from AI responses.
"""

import asyncio
import os
from typing import Optional
import logging

from app.logs.logger import get_logger

logger = get_logger(__name__)


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
        self.voice = os.getenv("TTS_VOICE", "en-IN-NeerjaNeural")
        self.rate = os.getenv("TTS_RATE", "+15%")  # 1.15x speed for natural conversation
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
            
            # Auto-select voice based on language
            if language and language in self.voices:
                voice_to_use = self.voices[language]
            elif voice:
                voice_to_use = voice
            else:
                voice_to_use = self.voice
            
            logger.debug(f"Synthesizing: {text[:50]}... with voice: {voice_to_use}")
            
            # Create communicate object
            communicate = edge_tts.Communicate(
                text,
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
    
    async def synthesize_stream(
        self,
        text: str,
        voice: Optional[str] = None
    ) -> Optional[bytes]:
        """
        Synthesize text to audio with streaming.
        
        Args:
            text: Text to synthesize
            voice: Voice to use
        
        Returns:
            Audio bytes or None if synthesis fails
        """
        return await self.synthesize(text, voice)
    
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
