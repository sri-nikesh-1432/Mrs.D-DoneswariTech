"""
Analytics Service - Provides campaign analytics and statistics.
Generates insights from campaign data directly from Student model fields.
"""

from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from collections import Counter

from app.database.models import Campaign, Student, CallStatus
from app.logs.logger import get_logger

logger = get_logger(__name__)


class AnalyticsService:
    """Service for campaign analytics and reporting."""

    async def get_campaign_analytics(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> Optional[Dict]:
        """
        Get comprehensive analytics for a campaign.

        Args:
            session: Database session
            campaign_id: Campaign ID

        Returns:
            Dictionary with campaign analytics
        """
        try:
            # Get campaign
            campaign_result = await session.execute(
                select(Campaign).where(Campaign.id == campaign_id)
            )
            campaign = campaign_result.scalar_one_or_none()

            if not campaign:
                return None

            # Get all students
            students_result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = students_result.scalars().all()

            total = len(students)
            completed = len([s for s in students if s.call_status == CallStatus.COMPLETED])
            failed = len([s for s in students if s.call_status == CallStatus.FAILED])
            pending = len([s for s in students if s.call_status == CallStatus.NOT_CALLED])

            interested = len([s for s in students if s.interest_score and s.interest_score >= 70])
            not_interested = len([s for s in students if s.interest_score and s.interest_score < 30])
            neutral = total - interested - not_interested

            # Sentiment
            sentiments = [s.sentiment.value for s in students if s.sentiment]
            sentiment_counts = Counter(sentiments)

            # Courses
            courses = [s.preferred_course for s in students if s.preferred_course]
            course_counts = Counter(courses)

            # Duration
            completed_students = [s for s in students if s.call_duration and s.call_duration > 0]
            avg_duration = (
                sum(s.call_duration for s in completed_students) / len(completed_students)
                if completed_students else 0
            )

            # Follow-up required
            follow_up = len([s for s in students if s.recommended_follow_up])

            # Questions & objections (stored as JSON arrays on Student)
            all_questions = []
            all_objections = []
            for s in students:
                if s.questions_asked:
                    try:
                        if isinstance(s.questions_asked, list):
                            all_questions.extend(s.questions_asked)
                    except Exception:
                        pass
                if s.objections:
                    try:
                        if isinstance(s.objections, list):
                            all_objections.extend(s.objections)
                    except Exception:
                        pass

            return {
                "campaign_id": campaign.id,
                "campaign_name": campaign.campaign_name,
                "institute_name": campaign.institute_name,
                "status": campaign.status.value,
                "total_students": total,
                "completed_calls": completed,
                "failed_calls": failed,
                "pending_calls": pending,
                "completion_rate": round((completed / total * 100) if total > 0 else 0, 1),
                "interested_students": interested,
                "not_interested": not_interested,
                "neutral_students": max(0, neutral),
                "interest_rate": round((interested / total * 100) if total > 0 else 0, 1),
                "sentiment_distribution": dict(sentiment_counts),
                "course_distribution": dict(course_counts),
                "average_call_duration": round(avg_duration, 1),
                "total_call_duration": sum(s.call_duration or 0 for s in students),
                "follow_up_required": follow_up,
                "most_asked_questions": Counter(all_questions).most_common(10),
                "common_objections": Counter(all_objections).most_common(10),
                "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
                "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
            }

        except Exception as e:
            logger.error(f"Failed to get campaign analytics: {e}")
            return None

    async def get_student_analytics(
        self, session: AsyncSession, campaign_id: int
    ) -> List[Dict]:
        """Get analytics for all students in a campaign."""
        try:
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = result.scalars().all()

            return [
                {
                    "student_id": s.id,
                    "name": s.name,
                    "phone": s.phone,
                    "preferred_course": s.preferred_course,
                    "call_status": s.call_status.value,
                    "call_duration": s.call_duration,
                    "sentiment": s.sentiment.value if s.sentiment else None,
                    "interest_score": s.interest_score,
                    "admission_probability": s.admission_probability,
                    "called_at": s.called_at.isoformat() if s.called_at else None,
                }
                for s in students
            ]

        except Exception as e:
            logger.error(f"Failed to get student analytics: {e}")
            return []

    async def get_time_series_analytics(
        self, session: AsyncSession, campaign_id: int
    ) -> Dict:
        """Get time-series analytics for campaign progress."""
        try:
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = result.scalars().all()

            calls_by_time = {}
            for s in students:
                if s.called_at:
                    key = s.called_at.strftime("%Y-%m-%d %H:00")
                    calls_by_time[key] = calls_by_time.get(key, 0) + 1

            return {"campaign_id": campaign_id, "calls_by_time": calls_by_time}

        except Exception as e:
            logger.error(f"Failed to get time-series analytics: {e}")
            return {}

    async def get_comparison_analytics(
        self, session: AsyncSession, campaign_ids: List[int]
    ) -> Dict:
        """Compare analytics across multiple campaigns."""
        comparison = {}
        for cid in campaign_ids:
            analytics = await self.get_campaign_analytics(session, cid)
            if analytics:
                comparison[cid] = analytics
        return comparison
