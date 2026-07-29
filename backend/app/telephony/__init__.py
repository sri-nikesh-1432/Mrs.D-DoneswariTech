"""
Telephony module for Mrs. D AI Admission Campaign Platform.
Provides pluggable interface for telephony providers.
"""

from .telephony_interface import TelephonyProvider, TelephonyEvent
from .mock_provider import MockTelephonyProvider
from .twilio_provider import TwilioProvider, get_twilio_provider

__all__ = ["TelephonyProvider", "TelephonyEvent", "MockTelephonyProvider", "TwilioProvider", "get_twilio_provider"]
