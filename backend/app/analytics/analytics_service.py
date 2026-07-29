"""
Analytics Service - Provides campaign analytics and statistics.
Generates insights from campaign data.
"""

from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from collections import Counter

from app.database.models import Campaign, Student, Summary, CallStatus, Sentiment
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
            
            # Get all students for the campaign
            students_result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = students_result.scalars().all()
            
            # Calculate basic statistics
            total_students = len(students)
            completed_calls = len([s for s in students if s.call_status == CallStatus.COMPLETED])
            failed_calls = len([s for s in students if s.call_status == CallStatus.FAILED])
            pending_calls = len([s for s in students if s.call_status == CallStatus.NOT_CALLED])
            
            # Interest statistics
            interested_students = len([s for s in students if s.interest_score and s.interest_score >= 70])
            not_interested = len([s for s in students if s.interest_score and s.interest_score < 30])
            neutral = len([s for s in students if s.interest_score and 30 <= s.interest_score < 70])
            
            # Sentiment distribution
            sentiments = [s.sentiment.value for s in students if s.sentiment]
            sentiment_counts = Counter(sentiments)
            
            # Course interest distribution
            courses = [s.preferred_course for s in students if s.preferred_course]
            course_counts = Counter(courses)
            
            # Average call duration
            completed_students = [s for s in students if s.call_duration > 0]
            avg_duration = sum(s.call_duration for s in completed_students) / len(completed_students) if completed_students else 0
            
            # Follow-up statistics
            follow_up_required = len([s for s in students if s.summary and s.summary.follow_up_required])
            
            # Get most asked questions
            all_questions = []
            for student in students:
                if student.summary and student.summary.questions_asked:
                    try:
                        import json
                        questions = json.loads(student.summary.questions_asked)
                        all_questions.extend(questions)
                    except:
                        pass
            
            question_counts = Counter(all_questions)
            most_asked_questions = question_counts.most_common(10)
            
            # Get common objections
            all_objections = []
            for student in students:
                if student.summary and student.summary.objections:
                    try:
                        import json
                        objections = json.loads(student.summary.interjections)
                        all_objections.extend(objections)
                    except:
                        pass
            
            objection_counts = Counter(all_objections)
            common_objections = objection_counts.most_common(10)
            
            analytics = {
                "campaign_id": campaign.id,
                "campaign_name": campaign.campaign_name,
                "institute_name": campaign.institute_name,
                "status": campaign.status.value,
                
                # Call statistics
                "total_students": total_students,
                "completed_calls": completed_calls,
                "failed_calls": failed_calls,
                "pending_calls": pending_calls,
                "completion_rate": (completed_calls / total_students * 100) if total_students > 0 else 0,
                
                # Interest statistics
                "interested_students": interested_students,
                "not_interested": not_interested,
                "neutral_students": neutral,
                "interest_rate": (interested_students / total_students * 100) if total_students > 0 else 0,
                
                # Sentiment distribution
                "sentiment_distribution": dict(sentiment_counts),
                
                # Course distribution
                "course_distribution": dict(course_counts),
                
                # Duration statistics
                "average_call_duration": avg_duration,
                "total_call_duration": sum(s.call_duration for s in students),
                
                # Follow-up statistics
                "follow_up_required": follow_up_required,
                
                # Questions and objections
                "most_asked_questions": most_asked_questions,
                "common_objections": common_objections,
                
                # Timestamps
                "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
                "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
            }
            
            return analytics
        
        except Exception as e:
            logger.error(f"Failed to get campaign analytics: {e}")
            return None
    
    async def get_student_analytics(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> List[Dict]:
        """
        Get analytics for all students in a campaign.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            List of student analytics dictionaries
        """
        try:
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = result.scalars().all()
            
            student_analytics = []
            for student in students:
                student_analytics.append({
                    "student_id": student.id,
                    "name": student.name,
                    "phone": student.phone,
                    "preferred_course": student.preferred_course,
                    "call_status": student.call_status.value,
                    "call_duration": student.call_duration,
                    "sentiment": student.sentiment.value if student.sentiment else None,
                    "interest_score": student.interest_score,
                    "admission_probability": student.admission_probability,
                    "called_at": student.called_at.isoformat() if student.called_at else None,
                })
            
            return student_analytics
        
        except Exception as e:
            logger.error(f"Failed to get student analytics: {e}")
            return []
    
    async def get_time_series_analytics(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> Dict:
        """
        Get time-series analytics for campaign progress.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            Dictionary with time-series data
        """
        try:
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = result.scalars().all()
            
            # Group calls by hour/day
            calls_by_time = {}
            for student in students:
                if student.called_at:
                    time_key = student.called_at.strftime("%Y-%m-%d %H:00")
                    calls_by_time[time_key] = calls_by_time.get(time_key, 0) + 1
            
            return {
                "campaign_id": campaign_id,
                "calls_by_time": calls_by_time,
            }
        
        except Exception as e:
            logger.error(f"Failed to get time-series analytics: {e}")
            return {}
    
    async def get_comparison_analytics(
        self,
        session: AsyncSession,
        campaign_ids: List[int]
    ) -> Dict:
        """
        Compare analytics across multiple campaigns.
        
        Args:
            session: Database session
            campaign_ids: List of campaign IDs to compare
            
        Returns:
            Dictionary with comparison data
        """
        try:
            comparison = {}
            
            for campaign_id in campaign_ids:
                analytics = await self.get_campaign_analytics(session, campaign_id)
                if analytics:
                    comparison[campaign_id] = analytics
            
            return comparison
        
        except Exception as e:
            logger.error(f"Failed to get comparison analytics: {e}")
            return {}
