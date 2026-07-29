"""
Telephony module for Mrs. D AI Admission Campaign Platform.
Provides pluggable interface for telephony providers.
"""

from .telephony_interface import TelephonyProvider, TelephonyEvent
from .mock_provider import MockTelephonyProvider

__all__ = ["TelephonyProvider", "TelephonyEvent", "MockTelephonyProvider"]
