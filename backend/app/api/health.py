"""
Health check API endpoint.
"""

from datetime import datetime, timezone
from fastapi import APIRouter
from app.config import settings
from app.rag.retriever import is_knowledge_ready
from app.campaign.manager import campaign_manager
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/health")
async def health_check():
    """System health check."""
    return {
        "status": "healthy",
        "agent": "Mrs. D",
        "platform": "AI Admission Campaign Platform",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gemini_configured": settings.is_gemini_configured,
        "knowledge_ready": is_knowledge_ready(),
        "campaign_running": campaign_manager.is_running,
        "server": {
            "host": settings.HOST,
            "port": settings.PORT,
        },
    }
