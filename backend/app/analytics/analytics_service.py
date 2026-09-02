"""
Analytics Service - Provides analytics and statistics for Mrs. D platform.
Uses the actual database models: Institute, CallHistory, CallAnalytics.
"""

from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta

from app.database.models import Institute, CallHistory, CallAnalytics, CallStatus, Sentiment
from app.logs.logger import get_logger

logger = get_logger(__name__)


class AnalyticsService:
    """Service for platform analytics and reporting."""

    async def get_institute_analytics(
        self,
        session: AsyncSession,
        institute_id: int
    ) -> Optional[Dict]:
        """
        Get comprehensive analytics for an institute.

        Args:
            session: Database session
            institute_id: Institute ID

        Returns:
            Dictionary with institute analytics
        """
        try:
            # Get institute
            institute_result = await session.execute(
                select(Institute).where(Institute.id == institute_id)
            )
            institute = institute_result.scalar_one_or_none()

            if not institute:
                return None

            # Get all calls for this institute
            calls_result = await session.execute(
                select(CallHistory).where(CallHistory.institute_id == institute_id)
            )
            calls = calls_result.scalars().all()

            total = len(calls)
            completed = len([c for c in calls if c.call_status == CallStatus.COMPLETED])
            failed = len([c for c in calls if c.call_status == CallStatus.FAILED])
            missed = len([c for c in calls if c.call_status == CallStatus.MISSED])

            # Duration stats
            completed_calls = [c for c in calls if c.duration_seconds and c.duration_seconds > 0]
            avg_duration = (
                sum(c.duration_seconds for c in completed_calls) / len(completed_calls)
                if completed_calls else 0
            )

            # Sentiment distribution
            sentiments = [c.sentiment.value for c in calls if c.sentiment]
            from collections import Counter
            sentiment_counts = Counter(sentiments)

            # Languages detected
            languages = [c.detected_language for c in calls if c.detected_language]
            language_counts = Counter(languages)

            # Performance metrics
            avg_retrieval = [c.avg_retrieval_time_ms for c in calls if c.avg_retrieval_time_ms]
            avg_llm = [c.avg_llm_response_time_ms for c in calls if c.avg_llm_response_time_ms]
            avg_stt = [c.avg_stt_time_ms for c in calls if c.avg_stt_time_ms]
            avg_tts = [c.avg_tts_time_ms for c in calls if c.avg_tts_time_ms]

            # Today's calls
            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            today_calls = len([c for c in calls if c.created_at and c.created_at >= today_start])

            return {
                "institute_id": institute.id,
                "institute_name": institute.name,
                "total_calls": total,
                "completed_calls": completed,
                "failed_calls": failed,
                "missed_calls": missed,
                "today_calls": today_calls,
                "completion_rate": round((completed / total * 100) if total > 0 else 0, 1),
                "average_call_duration": round(avg_duration, 1),
                "total_call_duration": sum(c.duration_seconds or 0 for c in calls),
                "sentiment_distribution": dict(sentiment_counts),
                "language_distribution": dict(language_counts),
                "avg_retrieval_time_ms": round(sum(avg_retrieval) / len(avg_retrieval), 1) if avg_retrieval else 0,
                "avg_llm_response_time_ms": round(sum(avg_llm) / len(avg_llm), 1) if avg_llm else 0,
                "avg_stt_time_ms": round(sum(avg_stt) / len(avg_stt), 1) if avg_stt else 0,
                "avg_tts_time_ms": round(sum(avg_tts) / len(avg_tts), 1) if avg_tts else 0,
                "total_turns": sum(c.total_turns or 0 for c in calls),
            }

        except Exception as e:
            logger.error(f"Failed to get institute analytics: {e}")
            return None

    async def get_call_history(
        self,
        session: AsyncSession,
        institute_id: int,
        limit: int = 50
    ) -> List[Dict]:
        """Get call history for an institute."""
        try:
            result = await session.execute(
                select(CallHistory)
                .where(CallHistory.institute_id == institute_id)
                .order_by(CallHistory.created_at.desc())
                .limit(limit)
            )
            calls = result.scalars().all()

            return [
                {
                    "call_id": c.call_id,
                    "caller_number": c.caller_number,
                    "caller_name": c.caller_name,
                    "status": c.call_status.value,
                    "started_at": c.started_at.isoformat() if c.started_at else None,
                    "ended_at": c.ended_at.isoformat() if c.ended_at else None,
                    "duration_seconds": c.duration_seconds,
                    "detected_language": c.detected_language,
                    "sentiment": c.sentiment.value if c.sentiment else None,
                    "summary": c.summary,
                    "total_turns": c.total_turns,
                }
                for c in calls
            ]

        except Exception as e:
            logger.error(f"Failed to get call history: {e}")
            return []
