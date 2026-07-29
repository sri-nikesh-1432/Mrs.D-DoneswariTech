"""
Summary Service - Generates AI-powered call summaries with sentiment analysis.
Uses Gemini to analyze transcripts and extract insights.
"""

import json
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database.models import Student, Summary, Sentiment
from app.rag.gemini_service import generate_summary
from app.logs.logger import get_logger

logger = get_logger(__name__)


class SummaryService:
    """Service for generating and managing call summaries."""
    
    async def generate_summary(
        self,
        session: AsyncSession,
        student_id: int,
        transcript: str
    ) -> Optional[Summary]:
        """
        Generate a summary for a student's call.
        
        Args:
            session: Database session
            student_id: Student ID
            transcript: Call transcript
            
        Returns:
            Summary object or None
        """
        try:
            # Get student information
            result = await session.execute(
                select(Student).where(Student.id == student_id)
            )
            student = result.scalar_one_or_none()
            
            if not student:
                logger.error(f"Student {student_id} not found")
                return None
            
            # Generate summary using Gemini
            logger.info(f"Generating summary for student {student_id}")
            summary_data = await generate_summary(transcript)
            
            # Parse sentiment
            sentiment_value = summary_data.get("sentiment", "neutral").lower()
            try:
                sentiment = Sentiment(sentiment_value)
            except ValueError:
                sentiment = Sentiment.NEUTRAL
            
            # Create or update summary
            existing_summary = await session.execute(
                select(Summary).where(Summary.student_id == student_id)
            )
            existing = existing_summary.scalar_one_or_none()
            
            if existing:
                # Update existing summary
                existing.transcript = transcript
                existing.summary = summary_data.get("summary", "")
                existing.sentiment = sentiment
                existing.interest_score = summary_data.get("interest_score", 50)
                existing.admission_probability = summary_data.get("admission_probability", 0.5)
                existing.questions_asked = json.dumps(summary_data.get("questions_asked", []))
                existing.objections = json.dumps(summary_data.get("objections", []))
                existing.recommended_course = summary_data.get("recommended_course")
                existing.follow_up_required = summary_data.get("follow_up_required", False)
                existing.follow_up_notes = summary_data.get("recommended_follow_up", "")
                
                summary_obj = existing
            else:
                # Create new summary
                summary_obj = Summary(
                    student_id=student_id,
                    transcript=transcript,
                    summary=summary_data.get("summary", ""),
                    sentiment=sentiment,
                    interest_score=summary_data.get("interest_score", 50),
                    admission_probability=summary_data.get("admission_probability", 0.5),
                    questions_asked=json.dumps(summary_data.get("questions_asked", [])),
                    objections=json.dumps(summary_data.get("objections", [])),
                    recommended_course=summary_data.get("recommended_course"),
                    follow_up_required=summary_data.get("follow_up_required", False),
                    follow_up_notes=summary_data.get("recommended_follow_up", "")
                )
                session.add(summary_obj)
            
            # Update student with sentiment and interest
            student.sentiment = sentiment
            student.interest_score = summary_data.get("interest_score", 50)
            student.admission_probability = summary_data.get("admission_probability", 0.5)
            
            await session.commit()
            await session.refresh(summary_obj)
            
            logger.info(f"Summary generated for student {student_id}")
            return summary_obj
        
        except Exception as e:
            logger.error(f"Failed to generate summary for student {student_id}: {e}")
            await session.rollback()
            return None
    
    async def get_summary(
        self,
        session: AsyncSession,
        student_id: int
    ) -> Optional[Summary]:
        """
        Get a student's summary.
        
        Args:
            session: Database session
            student_id: Student ID
            
        Returns:
            Summary object or None
        """
        try:
            result = await session.execute(
                select(Summary).where(Summary.student_id == student_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error(f"Failed to get summary for student {student_id}: {e}")
            return None
    
    async def get_summary_dict(
        self,
        session: AsyncSession,
        student_id: int
    ) -> Optional[Dict]:
        """
        Get a student's summary as a dictionary.
        
        Args:
            session: Database session
            student_id: Student ID
            
        Returns:
            Dictionary with summary data or None
        """
        summary = await self.get_summary(session, student_id)
        
        if not summary:
            return None
        
        try:
            return {
                "student_id": summary.student_id,
                "transcript": summary.transcript,
                "summary": summary.summary,
                "sentiment": summary.sentiment.value if summary.sentiment else None,
                "interest_score": summary.interest_score,
                "admission_probability": summary.admission_probability,
                "questions_asked": json.loads(summary.questions_asked) if summary.questions_asked else [],
                "objections": json.loads(summary.objections) if summary.objections else [],
                "recommended_course": summary.recommended_course,
                "follow_up_required": summary.follow_up_required,
                "follow_up_notes": summary.follow_up_notes,
                "generated_at": summary.generated_at.isoformat() if summary.generated_at else None
            }
        except Exception as e:
            logger.error(f"Failed to parse summary data: {e}")
            return None
    
    async def analyze_sentiment_simple(self, text: str) -> str:
        """
        Simple sentiment analysis using keyword matching.
        This is a fallback when Gemini is not available.
        
        Args:
            text: Text to analyze
            
        Returns:
            Sentiment value: 'positive', 'neutral', or 'negative'
        """
        positive_words = [
            "interested", "yes", "good", "great", "excellent", "sure",
            "definitely", "please", "thank", "appreciate", "love", "like",
            "excited", "happy", "wonderful", "amazing", "fantastic"
        ]
        
        negative_words = [
            "no", "not interested", "expensive", "costly", "too much",
            "cannot afford", "don't", "won't", "never", "disappointed",
            "bad", "terrible", "awful", "hate", "dislike", "angry"
        ]
        
        text_lower = text.lower()
        
        positive_count = sum(1 for word in positive_words if word in text_lower)
        negative_count = sum(1 for word in negative_words if word in text_lower)
        
        if positive_count > negative_count:
            return "positive"
        elif negative_count > positive_count:
            return "negative"
        else:
            return "neutral"
    
    async def calculate_interest_score(
        self,
        sentiment: str,
        questions_asked: list,
        objections: list
    ) -> int:
        """
        Calculate interest score based on conversation factors.
        
        Args:
            sentiment: Sentiment value
            questions_asked: List of questions asked
            objections: List of objections raised
            
        Returns:
            Interest score (0-100)
        """
        score = 50  # Base score
        
        # Sentiment impact
        if sentiment == "positive":
            score += 20
        elif sentiment == "negative":
            score -= 20
        
        # Questions indicate interest
        score += min(len(questions_asked) * 5, 20)
        
        # Objections reduce interest (but can be addressed)
        score -= min(len(objections) * 5, 15)
        
        # Ensure score is within bounds
        return max(0, min(100, score))
