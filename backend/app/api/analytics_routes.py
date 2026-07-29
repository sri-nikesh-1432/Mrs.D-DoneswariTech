"""
Analytics API Routes - Handle campaign analytics and reporting.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database
from app.analytics.analytics_service import AnalyticsService
from app.reports.summary_service import SummaryService
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/campaign/{campaign_id}")
async def get_campaign_analytics(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get comprehensive analytics for a campaign."""
    try:
        analytics_service = AnalyticsService()
        analytics = await analytics_service.get_campaign_analytics(session, campaign_id)
        
        if not analytics:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        return analytics
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting campaign analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/campaign/{campaign_id}/students")
async def get_student_analytics(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get analytics for all students in a campaign."""
    try:
        analytics_service = AnalyticsService()
        student_analytics = await analytics_service.get_student_analytics(session, campaign_id)
        
        return {
            "campaign_id": campaign_id,
            "students": student_analytics
        }
    
    except Exception as e:
        logger.error(f"Error getting student analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/campaign/{campaign_id}/timeseries")
async def get_time_series_analytics(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get time-series analytics for campaign progress."""
    try:
        analytics_service = AnalyticsService()
        time_series = await analytics_service.get_time_series_analytics(session, campaign_id)
        
        return time_series
    
    except Exception as e:
        logger.error(f"Error getting time-series analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/student/{student_id}/summary")
async def get_student_summary(
    student_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get detailed summary for a student."""
    try:
        summary_service = SummaryService()
        summary = await summary_service.get_summary_dict(session, student_id)
        
        if not summary:
            raise HTTPException(status_code=404, detail="Summary not found")
        
        return summary
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting student summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))
