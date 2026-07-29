"""
Campaign API Routes - Handle campaign operations.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List

from app.database.connection import get_database
from app.campaign.campaign_service import CampaignService
from app.campaign.campaign_manager import campaign_manager
from app.campaign.call_manager import call_manager
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/campaigns", tags=["Campaigns"])


class CampaignCreate(BaseModel):
    campaign_name: str
    institute_name: str
    language: str = "en"
    voice: str = "en-US-AriaNeural"


class CampaignUpdate(BaseModel):
    campaign_name: Optional[str] = None
    institute_name: Optional[str] = None
    language: Optional[str] = None
    voice: Optional[str] = None


@router.post("/")
async def create_campaign(
    campaign_data: CampaignCreate,
    session: AsyncSession = Depends(get_database)
):
    """Create a new campaign."""
    try:
        campaign_service = CampaignService()
        campaign = await campaign_service.create_campaign(
            session=session,
            campaign_name=campaign_data.campaign_name,
            institute_name=campaign_data.institute_name,
            language=campaign_data.language,
            voice=campaign_data.voice
        )
        
        return {
            "message": "Campaign created successfully",
            "campaign_id": campaign.id,
            "campaign_name": campaign.campaign_name,
            "institute_name": campaign.institute_name,
            "status": campaign.status.value
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
        campaign_service = CampaignService()
        campaigns = await campaign_service.list_campaigns(session, limit, offset)
        
        return {
            "campaigns": [
                {
                    "id": c.id,
                    "campaign_name": c.campaign_name,
                    "institute_name": c.institute_name,
                    "status": c.status.value,
                    "total_students": c.total_students,
                    "completed_calls": c.completed_calls,
                    "failed_calls": c.failed_calls,
                    "interested_students": c.interested_students,
                    "average_duration": c.average_duration,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "started_at": c.started_at.isoformat() if c.started_at else None,
                    "completed_at": c.completed_at.isoformat() if c.completed_at else None
                }
                for c in campaigns
            ]
        }
    
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
        campaign_service = CampaignService()
        campaign = await campaign_service.get_campaign(session, campaign_id)
        
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        return {
            "id": campaign.id,
            "campaign_name": campaign.campaign_name,
            "institute_name": campaign.institute_name,
            "status": campaign.status.value,
            "language": campaign.language,
            "voice": campaign.voice,
            "total_students": campaign.total_students,
            "completed_calls": campaign.completed_calls,
            "failed_calls": campaign.failed_calls,
            "interested_students": campaign.interested_students,
            "follow_up_required": campaign.follow_up_required,
            "average_duration": campaign.average_duration,
            "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
            "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
            "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None
        }
    
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
        campaign_service = CampaignService()
        
        # Build update dict with only provided fields
        update_data = {}
        if campaign_data.campaign_name is not None:
            update_data["campaign_name"] = campaign_data.campaign_name
        if campaign_data.institute_name is not None:
            update_data["institute_name"] = campaign_data.institute_name
        if campaign_data.language is not None:
            update_data["language"] = campaign_data.language
        if campaign_data.voice is not None:
            update_data["voice"] = campaign_data.voice
        
        campaign = await campaign_service.update_campaign(session, campaign_id, **update_data)
        
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        return {
            "message": "Campaign updated successfully",
            "campaign_id": campaign.id,
            "campaign_name": campaign.campaign_name,
            "institute_name": campaign.institute_name
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
        campaign_service = CampaignService()
        success = await campaign_service.delete_campaign(session, campaign_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
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
        # Check if campaign can be started
        campaign_service = CampaignService()
        can_start, reason = await campaign_service.can_start_campaign(session, campaign_id)
        
        if not can_start:
            raise HTTPException(status_code=400, detail=reason)
        
        # Define call callback
        async def call_callback(student, campaign):
            await call_manager.initiate_call(
                student=student,
                campaign=campaign,
                session=session
            )
        
        # Start campaign
        success = await campaign_manager.start_campaign(
            campaign_id=campaign_id,
            session=session,
            call_callback=call_callback
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to start campaign")
        
        return {
            "message": "Campaign started successfully",
            "campaign_id": campaign_id
        }
    
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
        success = await campaign_manager.pause_campaign(session)
        
        if not success:
            raise HTTPException(status_code=400, detail="No active campaign to pause")
        
        return {
            "message": "Campaign paused successfully",
            "campaign_id": campaign_id
        }
    
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
        success = await campaign_manager.resume_campaign(session)
        
        if not success:
            raise HTTPException(status_code=400, detail="No paused campaign to resume")
        
        return {
            "message": "Campaign resumed successfully",
            "campaign_id": campaign_id
        }
    
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
        success = await campaign_manager.cancel_campaign(session)
        
        if not success:
            raise HTTPException(status_code=400, detail="No active campaign to cancel")
        
        return {
            "message": "Campaign cancelled successfully",
            "campaign_id": campaign_id
        }
    
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
        status = await campaign_manager.get_campaign_status(session, campaign_id)
        
        if not status:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        return status
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting campaign status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
