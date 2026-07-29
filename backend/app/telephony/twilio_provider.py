"""
Twilio Telephony Provider - Real phone call implementation.
"""

import os
from typing import Optional, Dict, Any
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse
from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class TwilioProvider:
    """Twilio telephony provider for making real phone calls."""
    
    def __init__(self):
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.twilio_number = os.getenv("TWILIO_PHONE_NUMBER")
        self.client = None
        self._initialize_client()
    
    def _initialize_client(self):
        """Initialize Twilio client."""
        if not all([self.account_sid, self.auth_token, self.twilio_number]):
            logger.warning("Twilio credentials not configured. Using mock mode.")
            return
        
        try:
            self.client = Client(self.account_sid, self.auth_token)
            logger.info("Twilio client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Twilio client: {e}")
    
    def make_call(
        self,
        to_number: str,
        from_number: Optional[str] = None,
        url: Optional[str] = None,
        twiml: Optional[str] = None,
        status_callback: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Make a phone call using Twilio.
        
        Args:
            to_number: Phone number to call (E.164 format)
            from_number: Twilio phone number to call from (default: configured number)
            url: URL for TwiML instructions
            twiml: TwiML string for call instructions
            status_callback: URL for status callbacks
            
        Returns:
            Dict with call details
        """
        if not self.client:
            logger.warning("Twilio client not initialized. Returning mock call.")
            return self._mock_call(to_number)
        
        try:
            from_number = from_number or self.twilio_number
            
            # Format phone numbers to E.164
            to_number = self._format_phone_number(to_number)
            from_number = self._format_phone_number(from_number)
            
            logger.info(f"Making Twilio call from {from_number} to {to_number}")
            
            call = self.client.calls.create(
                to=to_number,
                from_=from_number,
                url=url,
                twiml=twiml,
                status_callback=status_callback,
                status_callback_event=["initiated", "ringing", "answered", "completed"]
            )
            
            logger.info(f"Twilio call initiated: {call.sid}")
            
            return {
                "success": True,
                "call_sid": call.sid,
                "status": call.status,
                "direction": call.direction,
                "from_number": call.from_,
                "to_number": call.to,
                "provider": "twilio"
            }
            
        except Exception as e:
            logger.error(f"Error making Twilio call: {e}")
            return {
                "success": False,
                "error": str(e),
                "provider": "twilio"
            }
    
    def _format_phone_number(self, number: str) -> str:
        """Format phone number to E.164 format."""
        # Remove all non-digit characters
        digits = ''.join(c for c in number if c.isdigit())
        
        # If already has country code, return as is
        if number.startswith('+'):
            return number
        
        # Add country code (assuming India +91 for now)
        if len(digits) == 10:
            return f"+91{digits}"
        elif len(digits) == 12 and digits.startswith('91'):
            return f"+{digits}"
        else:
            # Try to add + if missing
            return f"+{digits}"
    
    def _mock_call(self, to_number: str) -> Dict[str, Any]:
        """Return a mock call response for testing without Twilio."""
        import uuid
        mock_sid = f"MOCK_{uuid.uuid4().hex[:16]}"
        
        logger.info(f"Mock call initiated to {to_number} (SID: {mock_sid})")
        
        return {
            "success": True,
            "call_sid": mock_sid,
            "status": "ringing",
            "direction": "outbound",
            "from_number": self.twilio_number or "+911234567890",
            "to_number": to_number,
            "provider": "mock"
        }
    
    def get_call_status(self, call_sid: str) -> Dict[str, Any]:
        """Get the status of a call."""
        if not self.client:
            return {
                "call_sid": call_sid,
                "status": "completed",
                "provider": "mock"
            }
        
        try:
            call = self.client.calls(call_sid).fetch()
            return {
                "call_sid": call.sid,
                "status": call.status,
                "direction": call.direction,
                "from_number": call.from_,
                "to_number": call.to,
                "duration": call.duration,
                "provider": "twilio"
            }
        except Exception as e:
            logger.error(f"Error getting call status: {e}")
            return {
                "call_sid": call_sid,
                "status": "unknown",
                "error": str(e),
                "provider": "twilio"
            }
    
    def hangup_call(self, call_sid: str) -> bool:
        """Hang up an active call."""
        if not self.client:
            logger.info(f"Mock hangup for call {call_sid}")
            return True
        
        try:
            call = self.client.calls(call_sid).update(status="completed")
            logger.info(f"Call {call_sid} hung up successfully")
            return True
        except Exception as e:
            logger.error(f"Error hanging up call: {e}")
            return False
    
    def generate_twiml(self, text: str, voice: str = "alice") -> str:
        """Generate TwiML for text-to-speech."""
        response = VoiceResponse()
        response.say(text, voice=voice)
        return str(response)


# Global instance
_twilio_provider = None


def get_twilio_provider() -> TwilioProvider:
    """Get or create the Twilio provider instance."""
    global _twilio_provider
    if _twilio_provider is None:
        _twilio_provider = TwilioProvider()
    return _twilio_provider
