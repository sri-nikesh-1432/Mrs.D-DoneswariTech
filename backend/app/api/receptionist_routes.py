"""
API Routes for Mrs. D AI Voice Receptionist Platform.
Handles institute management, calls, and analytics.
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from datetime import datetime, timezone, timedelta

from app.database.connection import get_database
from app.database.models import Institute, CallHistory, CallAnalytics, CallStatus
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/receptionist", tags=["Receptionist"])


# ── Institute Management ─────────────────────────────────────────────────────

@router.get("/institutes")
async def list_institutes(
    session: AsyncSession = Depends(get_database)
):
    """List all institutes (used by dashboards to resolve the default one)."""
    try:
        result = await session.execute(
            select(Institute).order_by(Institute.id.asc())
        )
        institutes = result.scalars().all()

        return {
            "institutes": [
                {
                    "id": inst.id,
                    "institute_id": inst.institute_id,
                    "name": inst.name,
                    "phone_number": inst.phone_number,
                    "total_calls": inst.total_calls,
                    "completed_calls": inst.completed_calls,
                }
                for inst in institutes
            ]
        }
    except Exception as e:
        logger.error(f"Error listing institutes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/institute")
async def create_institute(
    name: str,
    phone_number: str,
    language: str = "en",
    voice: str = "en-IN-NeerjaNeural",
    greeting_message: Optional[str] = None,
    session: AsyncSession = Depends(get_database)
):
    """Create a new institute."""
    try:
        institute = Institute(
            institute_id=f"inst_{uuid.uuid4().hex[:12]}",
            name=name,
            phone_number=phone_number,
            language=language,
            voice=voice,
            greeting_message=greeting_message
        )
        session.add(institute)
        await session.commit()
        await session.refresh(institute)
        
        logger.info(f"Created institute: {institute.name}")
        
        return {
            "institute_id": institute.institute_id,
            "id": institute.id,
            "name": institute.name,
            "phone_number": institute.phone_number,
            "status": "active"
        }
    except Exception as e:
        logger.error(f"Error creating institute: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/institute/{institute_id}")
async def get_institute(
    institute_id: str,
    session: AsyncSession = Depends(get_database)
):
    """Get institute details."""
    try:
        result = await session.execute(
            select(Institute).where(Institute.institute_id == institute_id)
        )
        institute = result.scalar_one_or_none()
        
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")
        
        return {
            "institute_id": institute.institute_id,
            "id": institute.id,
            "name": institute.name,
            "phone_number": institute.phone_number,
            "language": institute.language,
            "voice": institute.voice,
            "greeting_message": institute.greeting_message,
            "total_calls": institute.total_calls,
            "completed_calls": institute.completed_calls,
            "missed_calls": institute.missed_calls,
            "total_duration_seconds": institute.total_duration_seconds
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting institute: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/institute/{institute_id}/status")
async def get_institute_status(
    institute_id: str,
    session: AsyncSession = Depends(get_database)
):
    """Get institute status including SIP and knowledge."""
    try:
        result = await session.execute(
            select(Institute).where(Institute.institute_id == institute_id)
        )
        institute = result.scalar_one_or_none()
        
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")
        
        # Get knowledge status
        from app.database.models import Knowledge
        knowledge_result = await session.execute(
            select(Knowledge).where(Knowledge.institute_id == institute.id)
        )
        knowledge = knowledge_result.scalar_one_or_none()
        
        return {
            "institute_id": institute.institute_id,
            "name": institute.name,
            "phone_number": institute.phone_number,
            "knowledge_status": knowledge.status.value if knowledge else "not_uploaded",
            "knowledge_document": knowledge.document_name if knowledge else None,
            "total_calls": institute.total_calls,
            "completed_calls": institute.completed_calls
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting institute status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Call History ─────────────────────────────────────────────────────────────

@router.get("/institute/{institute_id}/calls")
async def get_call_history(
    institute_id: str,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_database)
):
    """Get call history for an institute."""
    try:
        # Get institute
        inst_result = await session.execute(
            select(Institute).where(Institute.institute_id == institute_id)
        )
        institute = inst_result.scalar_one_or_none()
        
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")
        
        # Get calls
        result = await session.execute(
            select(CallHistory)
            .where(CallHistory.institute_id == institute.id)
            .order_by(CallHistory.started_at.desc())
            .limit(limit)
            .offset(offset)
        )
        calls = result.scalars().all()
        
        return {
            "institute_id": institute_id,
            "total": len(calls),
            "calls": [
                {
                    "call_id": call.call_id,
                    "caller_number": call.caller_number,
                    "caller_name": call.caller_name,
                    "call_status": call.call_status.value,
                    "started_at": call.started_at.isoformat() if call.started_at else None,
                    "duration_seconds": call.duration_seconds,
                    "sentiment": call.sentiment.value if call.sentiment else None,
                    "total_turns": call.total_turns
                }
                for call in calls
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting call history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/call/{call_id}")
async def get_call_details(
    call_id: str,
    session: AsyncSession = Depends(get_database)
):
    """Get detailed call information."""
    try:
        result = await session.execute(
            select(CallHistory).where(CallHistory.call_id == call_id)
        )
        call = result.scalar_one_or_none()
        
        if not call:
            raise HTTPException(status_code=404, detail="Call not found")
        
        return {
            "call_id": call.call_id,
            "caller_number": call.caller_number,
            "caller_name": call.caller_name,
            "call_status": call.call_status.value,
            "started_at": call.started_at.isoformat() if call.started_at else None,
            "answered_at": call.answered_at.isoformat() if call.answered_at else None,
            "ended_at": call.ended_at.isoformat() if call.ended_at else None,
            "duration_seconds": call.duration_seconds,
            "transcript": call.transcript,
            "summary": call.summary,
            "questions_asked": call.questions_asked,
            "topics_discussed": call.topics_discussed,
            "sentiment": call.sentiment.value if call.sentiment else None,
            "retrieved_chunks": call.retrieved_chunks,
            "total_turns": call.total_turns,
            "avg_retrieval_time_ms": call.avg_retrieval_time_ms,
            "avg_llm_response_time_ms": call.avg_llm_response_time_ms,
            "avg_stt_time_ms": call.avg_stt_time_ms,
            "avg_tts_time_ms": call.avg_tts_time_ms,
            "error_message": call.error_message
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting call details: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Analytics ───────────────────────────────────────────────────────────────

@router.get("/institute/{institute_id}/analytics")
async def get_analytics(
    institute_id: str,
    session: AsyncSession = Depends(get_database)
):
    """Get analytics for an institute."""
    try:
        # Get institute
        inst_result = await session.execute(
            select(Institute).where(Institute.institute_id == institute_id)
        )
        institute = inst_result.scalar_one_or_none()
        
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")
        
        # Get or create analytics
        analytics_result = await session.execute(
            select(CallAnalytics).where(CallAnalytics.institute_id == institute.id)
        )
        analytics = analytics_result.scalar_one_or_none()
        
        if not analytics:
            # Create analytics record
            analytics = CallAnalytics(institute_id=institute.id)
            session.add(analytics)
            await session.commit()
            await session.refresh(analytics)
        
        # Calculate today's calls
        today = datetime.now(timezone.utc).date()
        today_result = await session.execute(
            select(func.count(CallHistory.id))
            .where(
                CallHistory.institute_id == institute.id,
                func.date(CallHistory.started_at) == today
            )
        )
        today_calls = today_result.scalar() or 0
        
        return {
            "institute_id": institute_id,
            "total_calls": analytics.total_calls,
            "today_calls": today_calls,
            "completed_calls": analytics.completed_calls,
            "missed_calls": analytics.missed_calls,
            "avg_duration_seconds": analytics.avg_duration_seconds,
            "avg_retrieval_time_ms": analytics.avg_retrieval_time_ms,
            "avg_llm_response_time_ms": analytics.avg_llm_response_time_ms,
            "avg_stt_time_ms": analytics.avg_stt_time_ms,
            "avg_tts_time_ms": analytics.avg_tts_time_ms,
            "most_asked_questions": analytics.most_asked_questions,
            "top_retrieved_chunks": analytics.top_retrieved_chunks,
            "knowledge_coverage": analytics.knowledge_coverage,
            "peak_hours": analytics.peak_hours,
            "last_updated": analytics.last_updated.isoformat() if analytics.last_updated else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/institute/{institute_id}/live-status")
async def get_live_status(
    institute_id: str,
    session: AsyncSession = Depends(get_database)
):
    """Get live status including active calls."""
    try:
        # Get institute
        inst_result = await session.execute(
            select(Institute).where(Institute.institute_id == institute_id)
        )
        institute = inst_result.scalar_one_or_none()
        
        if not institute:
            raise HTTPException(status_code=404, detail="Institute not found")
        
        # Count active calls
        active_result = await session.execute(
            select(func.count(CallHistory.id))
            .where(
                CallHistory.institute_id == institute.id,
                CallHistory.call_status.in_([CallStatus.INCOMING, CallStatus.ANSWERED, CallStatus.LISTENING, CallStatus.THINKING, CallStatus.SPEAKING])
            )
        )
        active_calls = active_result.scalar() or 0
        
        return {
            "institute_id": institute_id,
            "name": institute.name,
            "phone_number": institute.phone_number,
            "active_calls": active_calls,
            "total_calls": institute.total_calls,
            "completed_calls": institute.completed_calls
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting live status: {e}")
        raise HTTPException(status_code=500, detail=str(e))
