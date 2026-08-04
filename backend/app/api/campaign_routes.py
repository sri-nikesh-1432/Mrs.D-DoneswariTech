"""
Campaign API Routes - Handle campaign CRUD and lifecycle operations.
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database.connection import get_database
from app.database.models import Campaign, CampaignStatus, KnowledgeStatus, Student, CallStatus
from app.campaign.manager import campaign_manager
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/campaigns", tags=["Campaigns"])


class CampaignCreate(BaseModel):
    campaign_name: str
    institute_name: str
    language: str = "en"
    voice: str = "en-IN-NeerjaNeural"


class CampaignUpdate(BaseModel):
    campaign_name: Optional[str] = None
    institute_name: Optional[str] = None
    language: Optional[str] = None
    voice: Optional[str] = None


def _campaign_to_dict(c: Campaign) -> dict:
    """Convert a Campaign model instance to a consistent API response dict."""
    total = c.total_students or 0
    completed = c.calls_completed or 0
    avg_duration = (
        round(c.total_duration_seconds / completed, 1) if completed > 0 else 0.0
    )
    return {
        "id": c.id,
        "campaign_name": c.campaign_name,
        "institute_name": c.institute_name,
        "status": c.status.value,
        "language": c.language,
        "voice": c.voice,
        "total_students": total,
        "completed_calls": completed,
        "failed_calls": c.calls_failed or 0,
        "calls_in_progress": c.calls_in_progress or 0,
        "interested_count": c.interested_count or 0,
        "follow_up_required": c.follow_up_required or 0,
        "average_duration": avg_duration,
        "progress": round((completed + (c.calls_failed or 0)) / max(total, 1) * 100, 1),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "started_at": c.started_at.isoformat() if c.started_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
    }


@router.post("/")
async def create_campaign(
    campaign_data: CampaignCreate,
    session: AsyncSession = Depends(get_database)
):
    """Create a new campaign."""
    try:
        campaign = Campaign(
            campaign_id=f"camp_{uuid.uuid4().hex[:12]}",
            campaign_name=campaign_data.campaign_name,
            institute_name=campaign_data.institute_name,
            language=campaign_data.language,
            voice=campaign_data.voice,
            status=CampaignStatus.PENDING,
        )
        session.add(campaign)
        await session.commit()
        await session.refresh(campaign)

        return {
            "message": "Campaign created successfully",
            "campaign_id": campaign.id,
            "campaign_name": campaign.campaign_name,
            "institute_name": campaign.institute_name,
            "status": campaign.status.value,
        }

    except Exception as e:
        logger.error(f"Error creating campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def list_campaigns(
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_database)
):
    """List all campaigns."""
    try:
        result = await session.execute(
            select(Campaign)
            .order_by(Campaign.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        campaigns = result.scalars().all()

        return {"campaigns": [_campaign_to_dict(c) for c in campaigns]}

    except Exception as e:
        logger.error(f"Error listing campaigns: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{campaign_id}")
async def get_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get a specific campaign."""
    try:
        result = await session.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = result.scalar_one_or_none()

        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        return _campaign_to_dict(campaign)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    campaign_data: CampaignUpdate,
    session: AsyncSession = Depends(get_database)
):
    """Update campaign details."""
    try:
        result = await session.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = result.scalar_one_or_none()

        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        if campaign_data.campaign_name is not None:
            campaign.campaign_name = campaign_data.campaign_name
        if campaign_data.institute_name is not None:
            campaign.institute_name = campaign_data.institute_name
        if campaign_data.language is not None:
            campaign.language = campaign_data.language
        if campaign_data.voice is not None:
            campaign.voice = campaign_data.voice

        await session.commit()
        await session.refresh(campaign)

        return {
            "message": "Campaign updated successfully",
            "campaign_id": campaign.id,
            "campaign_name": campaign.campaign_name,
            "institute_name": campaign.institute_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Delete a campaign."""
    try:
        result = await session.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = result.scalar_one_or_none()

        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        await session.delete(campaign)
        await session.commit()

        return {"message": "Campaign deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Start a campaign."""
    try:
        # Check campaign exists
        result = await session.execute(
            select(Campaign).where(Campaign.id == campaign_id)
        )
        campaign = result.scalar_one_or_none()

        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")

        # Check knowledge is ready
        from app.rag.retriever import is_knowledge_ready
        if not is_knowledge_ready():
            raise HTTPException(status_code=400, detail="Knowledge base is not ready")

        # Check students exist
        if campaign.total_students == 0:
            raise HTTPException(status_code=400, detail="No students loaded")

        # Start via the main campaign manager
        result = await campaign_manager.start_campaign(campaign_id)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to start"))

        return {"message": "Campaign started successfully", "campaign_id": campaign_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Pause a running campaign."""
    try:
        result = await campaign_manager.pause_campaign()
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "No active campaign"))
        return {"message": "Campaign paused successfully", "campaign_id": campaign_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error pausing campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{campaign_id}/resume")
async def resume_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Resume a paused campaign."""
    try:
        result = await campaign_manager.resume_campaign()
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "No paused campaign"))
        return {"message": "Campaign resumed successfully", "campaign_id": campaign_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resuming campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{campaign_id}/cancel")
async def cancel_campaign(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Cancel a running campaign."""
    try:
        result = await campaign_manager.cancel_campaign(campaign_id)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "No active campaign"))
        return {"message": "Campaign cancelled successfully", "campaign_id": campaign_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{campaign_id}/status")
async def get_campaign_status(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get current campaign status and statistics."""
    try:
        stats = await campaign_manager.get_campaign_stats(campaign_id)
        if "error" in stats:
            raise HTTPException(status_code=404, detail=stats["error"])
        return stats

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting campaign status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
