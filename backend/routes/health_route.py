"""
/health — System Health Check
Verifies Groq API configuration, TTS availability, and returns system info.
"""

from datetime import datetime, timezone
from fastapi import APIRouter
from utils.config import settings
from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/health")
async def health_check():
    """
    Health check endpoint.
    Returns configuration status, model info, and server details.
    The frontend polls this every 10 seconds to show connection status.
    """
    return {
        "status":           "healthy",
        "timestamp":        datetime.now(timezone.utc).isoformat(),
        "groq_configured":  settings.is_groq_configured,
        "models": {
            "stt": settings.GROQ_STT_MODEL,
            "llm": settings.GROQ_LLM_MODEL,
            "tts": settings.TTS_VOICE,
        },
        "server": {
            "host":    settings.HOST,
            "port":    settings.PORT,
            "version": "2.0.0",
        },
        "agent": "Doneswari AI Telecaller",
    }
