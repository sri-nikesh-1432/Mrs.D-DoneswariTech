"""
API module for Mrs. D AI Admission Campaign Platform.
"""

from .knowledge_routes import router as knowledge_router
from .student_routes import router as student_router
from .campaign_routes import router as campaign_router
from .websocket_routes import router as websocket_router
from .analytics_routes import router as analytics_router

__all__ = ["knowledge_router", "student_router", "campaign_router", "websocket_router", "analytics_router"]
