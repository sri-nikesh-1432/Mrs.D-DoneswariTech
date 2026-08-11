"""
Voice Service - Handles Speech-to-Text and Text-to-Speech operations.
Uses Edge-TTS for TTS and Whisper for STT.
"""

import asyncio
import edge_tts
import whisper
from typing import Optional
from pathlib import Path
import tempfile
import os

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class VoiceService:
    """Service for voice operations (TTS and STT)."""
    
    def __init__(self):
        self.tts_voice = settings.TTS_VOICE
        self.tts_rate = settings.TTS_RATE
        self.tts_volume = settings.TTS_VOLUME
        self.whisper_model = None
    
    def _load_whisper_model(self):
        """Lazy-load Whisper model for STT."""
        if self.whisper_model is None:
            logger.info("Loading Whisper model for speech-to-text...")
            self.whisper_model = whisper.load_model("base")
            logger.info("Whisper model loaded successfully")
        return self.whisper_model
    
    async def speak(self, text: str, output_file: Optional[str] = None) -> str:
        """
        Convert text to speech using Edge-TTS.
        
        Args:
            text: Text to convert to speech
            output_file: Optional file path to save audio
            
        Returns:
            Path to generated audio file
        """
        try:
            if not text or not text.strip():
                logger.warning("Empty text provided for TTS")
                return ""
            
            # Generate audio file path if not provided
            if output_file is None:
                output_file = tempfile.mktemp(suffix=".mp3", dir=settings.AUDIO_DIR)

            # Normalize fees/numbers/abbreviations so they are spoken naturally.
            from app.roman_telugu import normalize_for_speech
            spoken_text = normalize_for_speech(text)

            # Use Edge-TTS to generate speech
            communicate = edge_tts.Communicate(
                spoken_text,
                voice=self.tts_voice,
                rate=self.tts_rate,
                volume=self.tts_volume
            )
            
            await communicate.save(output_file)
            
            logger.info(f"TTS generated: {len(text)} chars -> {output_file}")
            return output_file
        
        except Exception as e:
            logger.error(f"TTS generation failed: {e}")
            raise
    
    async def listen(self, audio_file: str = None, timeout: int = 10) -> Optional[str]:
        """
        Convert speech to text using Whisper.
        
        Args:
            audio_file: Path to audio file (if None, waits for audio input)
            timeout: Maximum time to wait for audio
            
        Returns:
            Transcribed text or None if no audio detected
        """
        try:
            if audio_file:
                # Transcribe from file
                model = self._load_whisper_model()
                result = model.transcribe(audio_file)
                text = result["text"].strip()
                logger.info(f"STT transcribed: {len(text)} chars from {audio_file}")
                return text
            else:
                # In production, this would capture audio from telephony stream
                # For now, return None to indicate no audio
                logger.warning("No audio file provided for STT")
                return None
        
        except Exception as e:
            logger.error(f"STT transcription failed: {e}")
            return None
    
    async def speak_and_play(self, text: str) -> None:
        """
        Convert text to speech and play it (for local testing).
        
        Args:
            text: Text to speak
        """
        try:
            audio_file = await self.speak(text)
            
            # Play audio file (platform-specific)
            import platform
            system = platform.system()
            
            if system == "Windows":
                os.system(f'start "" "{audio_file}"')
            elif system == "Darwin":  # macOS
                os.system(f'afplay "{audio_file}"')
            elif system == "Linux":
                os.system(f'aplay "{audio_file}"')
            
            # Wait for audio to finish playing (rough estimate)
            await asyncio.sleep(len(text) / 15)  # ~15 chars per second
            
            # Clean up
            if os.path.exists(audio_file):
                os.remove(audio_file)
        
        except Exception as e:
            logger.error(f"Error speaking and playing: {e}")
    
    def set_voice(self, voice: str):
        """Set the TTS voice."""
        self.tts_voice = voice
        logger.info(f"TTS voice set to: {voice}")
    
    def set_rate(self, rate: str):
        """Set the TTS speaking rate."""
        self.tts_rate = rate
        logger.info(f"TTS rate set to: {rate}")
    
    def set_volume(self, volume: str):
        """Set the TTS volume."""
        self.tts_volume = volume
        logger.info(f"TTS volume set to: {volume}")


# Global voice service instance
voice_service = VoiceService()
