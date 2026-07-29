"""
Mock Telephony Provider - For testing and development.
Simulates telephony operations without actual phone calls.
"""

import asyncio
from typing import Optional, Callable
from app.telephony.telephony_interface import TelephonyProvider, TelephonyEvent
from app.logs.logger import get_logger

logger = get_logger(__name__)


class MockTelephonyProvider(TelephonyProvider):
    """Mock telephony provider for testing purposes."""
    
    def __init__(self):
        self.call_active = False
        self.phone_number = None
        self.on_audio_received = None
        self.on_call_ended = None
        self._audio_task = None
    
    async def initiate_call(
        self,
        phone_number: str,
        on_audio_received: Optional[Callable] = None,
        on_call_ended: Optional[Callable] = None
    ) -> bool:
        """
        Simulate initiating a call.
        
        Args:
            phone_number: Phone number to call
            on_audio_received: Callback for incoming audio
            on_call_ended: Callback for call end event
            
        Returns:
            True if call initiated successfully
        """
        try:
            self.phone_number = phone_number
            self.on_audio_received = on_audio_received
            self.on_call_ended = on_call_ended
            
            logger.info(f"[MOCK] Initiating call to {phone_number}")
            
            # Simulate connection delay
            await asyncio.sleep(1)
            
            self.call_active = True
            logger.info(f"[MOCK] Call connected to {phone_number}")
            
            # Start simulated audio stream
            self._audio_task = asyncio.create_task(self._simulate_audio_stream())
            
            return True
        
        except Exception as e:
            logger.error(f"[MOCK] Failed to initiate call: {e}")
            return False
    
    async def send_audio(self, audio_data: bytes) -> bool:
        """
        Simulate sending audio to the call.
        
        Args:
            audio_data: Audio data bytes
            
        Returns:
            True if audio sent successfully
        """
        if not self.call_active:
            logger.warning("[MOCK] No active call to send audio to")
            return False
        
        logger.debug(f"[MOCK] Sent {len(audio_data)} bytes of audio")
        return True
    
    async def end_call(self) -> bool:
        """
        Simulate ending the current call.
        
        Returns:
            True if call ended successfully
        """
        try:
            if not self.call_active:
                logger.warning("[MOCK] No active call to end")
                return False
            
            self.call_active = False
            
            if self._audio_task:
                self._audio_task.cancel()
                try:
                    await self._audio_task
                except asyncio.CancelledError:
                    pass
            
            logger.info(f"[MOCK] Call ended with {self.phone_number}")
            
            if self.on_call_ended:
                await self.on_call_ended()
            
            return True
        
        except Exception as e:
            logger.error(f"[MOCK] Failed to end call: {e}")
            return False
    
    async def get_call_status(self) -> dict:
        """
        Get current call status.
        
        Returns:
            Dictionary with call status information
        """
        return {
            "active": self.call_active,
            "phone_number": self.phone_number,
            "provider": "mock"
        }
    
    def is_call_active(self) -> bool:
        """
        Check if a call is currently active.
        
        Returns:
            True if call is active
        """
        return self.call_active
    
    async def cleanup(self):
        """Clean up resources."""
        if self.call_active:
            await self.end_call()
        logger.info("[MOCK] Telephony provider cleaned up")
    
    async def _simulate_audio_stream(self):
        """Simulate incoming audio stream for testing."""
        try:
            while self.call_active:
                # Simulate periodic audio input
                await asyncio.sleep(5)
                
                if self.call_active and self.on_audio_received:
                    # In a real implementation, this would be actual audio data
                    # For mock, we just trigger the callback
                    await self.on_audio_received(b"")
        
        except asyncio.CancelledError:
            logger.debug("[MOCK] Audio stream cancelled")
