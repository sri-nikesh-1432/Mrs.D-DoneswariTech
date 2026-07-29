"""
Database module for Mrs. D AI Admission Campaign Platform.
"""

from .connection import get_database, init_database
from .models import (
    Base,
    Campaign,
    Student,
    Knowledge,
    CallLog,
    Summary,
    Report
)

__all__ = [
    "get_database",
    "init_database",
    "Base",
    "Campaign",
    "Student",
    "Knowledge",
    "CallLog",
    "Summary",
    "Report"
]
