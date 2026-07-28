"""
Campaign management API endpoints.
Handles campaign creation, start, pause, resume, cancel, and status.
"""

import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.campaign.manager import campaign_manager
from app.rag.retriever import is_knowledge_ready
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


# ── Request Schemas ───────────────────────────────────────────────────────────

class CampaignCreateRequest(BaseModel):
    campaign_name: str = Field(..., min_length=1, max_length=255)
    institute_name: str = Field(..., min_length=1, max_length=255)
    language: str = Field(default="en", max_length=10)
    voice: str = Field(default="en-IN-NeerjaNeural", max_length=100)


class CampaignActionResponse(BaseModel):
    success: bool
    message: str
    data: Optional[dict] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/campaign/create")
async def create_campaign(request: CampaignCreateRequest):
    """Create a new campaign."""
    campaign_id = f"camp_{uuid.uuid4().hex[:12]}"
    result = await campaign_manager.create_campaign({
        "campaign_id": campaign_id,
        "campaign_name": request.campaign_name,
        "institute_name": request.institute_name,
        "language": request.language,
        "voice": request.voice,
    })
    return {
        "success": True,
        "message": "Campaign created",
        "data": result,
    }


@router.get("/campaign/status")
async def get_campaign_status(campaign_id: int):
    """Get current campaign status and statistics."""
    stats = await campaign_manager.get_campaign_stats(campaign_id)
    if "error" in stats:
        raise HTTPException(status_code=404, detail=stats["error"])
    return {
        "success": True,
        "data": stats,
    }


@router.post("/campaign/start")
async def start_campaign(campaign_id: int):
    """Start the campaign."""
    if not is_knowledge_ready():
        raise HTTPException(status_code=400, detail="Knowledge base is not ready. Upload knowledge documents first.")

    result = await campaign_manager.start_campaign(campaign_id)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to start campaign"))
    return {"success": True, "message": "Campaign started", "data": result}


@router.post("/campaign/pause")
async def pause_campaign():
    """Pause the running campaign."""
    result = await campaign_manager.pause_campaign()
    return result


@router.post("/campaign/resume")
async def resume_campaign():
    """Resume the paused campaign."""
    result = await campaign_manager.resume_campaign()
    return result


@router.post("/campaign/cancel")
async def cancel_campaign(campaign_id: int):
    """Cancel the campaign."""
    result = await campaign_manager.cancel_campaign(campaign_id)
    return result
