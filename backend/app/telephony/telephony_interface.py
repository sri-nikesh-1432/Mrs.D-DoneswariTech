"""
Telephony Interface - Abstract base class for telephony providers.
Allows pluggable integration with different telephony services (Twilio, etc.).
"""

from abc import ABC, abstractmethod
from typing import Optional, AsyncGenerator, Callable
from enum import Enum


class TelephonyEvent(Enum):
    """Telephony event types."""
    CALL_INITIATED = "call_initiated"
    CALL_CONNECTED = "call_connected"
    CALL_DISCONNECTED = "call_disconnected"
    AUDIO_RECEIVED = "audio_received"
    AUDIO_SENT = "audio_sent"
    ERROR = "error"


class TelephonyProvider(ABC):
    """
    Abstract base class for telephony providers.
    Implement this interface to add support for different telephony services.
    """
    
    @abstractmethod
    async def initiate_call(
        self,
        phone_number: str,
        on_audio_received: Optional[Callable] = None,
        on_call_ended: Optional[Callable] = None
    ) -> bool:
        """
        Initiate an outbound call to a phone number.
        
        Args:
            phone_number: Phone number to call (E.164 format)
            on_audio_received: Callback for incoming audio
            on_call_ended: Callback for call end event
            
        Returns:
            True if call initiated successfully
        """
        pass
    
    @abstractmethod
    async def send_audio(self, audio_data: bytes) -> bool:
        """
        Send audio data to the call.
        
        Args:
            audio_data: Audio data bytes
            
        Returns:
            True if audio sent successfully
        """
        pass
    
    @abstractmethod
    async def end_call(self) -> bool:
        """
        End the current call.
        
        Returns:
            True if call ended successfully
        """
        pass
    
    @abstractmethod
    async def get_call_status(self) -> dict:
        """
        Get current call status.
        
        Returns:
            Dictionary with call status information
        """
        pass
    
    @abstractmethod
    def is_call_active(self) -> bool:
        """
        Check if a call is currently active.
        
        Returns:
            True if call is active
        """
        pass
    
    @abstractmethod
    async def cleanup(self):
        """Clean up resources."""
        pass
