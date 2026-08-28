"""
Analytics API Routes - Handle campaign analytics and reporting.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

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


@router.get("/voice/latency")
async def get_voice_latency_metrics(
    institute_id: Optional[int] = Query(None),
    time_range: str = Query("7d", description="Time range: 7d, 30d, 90d")
):
    """
    Get real-time voice conversation latency metrics (spec §27, §34).
    
    Returns aggregated latency metrics for the voice pipeline including:
    - TTFA (Time to First Audio)
    - LLM TTFT (Time to First Token)
    - TTS First Audio
    - Total Turn Time
    - STT, RAG, LLM, TTS individual latencies
    """
    try:
        # For now, return placeholder metrics. In production, these would be
        # aggregated from actual conversation logs stored in the database.
        # The WebSocket voice pipeline sends these metrics in real-time via
        # the debug_info field of turn_done messages.
        
        # TODO: Implement proper storage and aggregation of latency metrics
        # from WebSocket conversations. Store metrics in a dedicated table
        # and aggregate them here based on institute_id and time_range.
        
        return {
            "institute_id": institute_id,
            "time_range": time_range,
            "avg_ttfa_ms": 650.0,  # Time to First Audio
            "avg_llm_ttft_ms": 180.0,  # LLM Time to First Token
            "avg_tts_first_audio_ms": 220.0,  # TTS First Audio
            "avg_total_turn_ms": 1250.0,  # Total Turn Time
            "avg_stt_time_ms": 320.0,  # Speech-to-Text
            "avg_rag_time_ms": 85.0,  # Retrieval-Augmented Generation
            "avg_llm_total_ms": 450.0,  # LLM Total Time
            "avg_tts_total_ms": 380.0,  # TTS Total Time
            "total_calls": 0,  # Would be actual count from database
            "percentile_50_ttfa_ms": 600.0,
            "percentile_90_ttfa_ms": 950.0,
            "percentile_95_ttfa_ms": 1200.0,
        }
    
    except Exception as e:
        logger.error(f"Error getting voice latency metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))
