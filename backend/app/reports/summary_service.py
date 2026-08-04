"""
Summary Service - Generates AI-powered call summaries with sentiment analysis.
Uses Gemini to analyze transcripts and stores results directly on Student model.
"""

import json
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database.models import Student, Sentiment
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
    ) -> Optional[Dict]:
        """
        Generate a summary for a student's call and store on the Student record.

        Args:
            session: Database session
            student_id: Student ID
            transcript: Call transcript

        Returns:
            Summary dict or None
        """
        try:
            result = await session.execute(
                select(Student).where(Student.id == student_id)
            )
            student = result.scalar_one_or_none()

            if not student:
                logger.error(f"Student {student_id} not found")
                return None

            logger.info(f"Generating summary for student {student_id}")
            summary_data = await generate_summary(transcript)

            sentiment_value = summary_data.get("sentiment", "neutral").lower()
            try:
                sentiment = Sentiment(sentiment_value)
            except ValueError:
                sentiment = Sentiment.NEUTRAL

            # Store summary data directly on the Student record
            student.call_summary = summary_data.get("summary", "")
            student.transcript = transcript
            student.sentiment = sentiment
            student.interest_score = summary_data.get("interest_score", 50)
            student.admission_probability = summary_data.get("admission_probability", 0.5)
            student.questions_asked = summary_data.get("questions_asked", [])
            student.objections = summary_data.get("objections", [])
            student.recommended_follow_up = summary_data.get("recommended_follow_up", "")

            await session.commit()
            await session.refresh(student)

            logger.info(f"Summary generated for student {student_id}")
            return summary_data

        except Exception as e:
            logger.error(f"Failed to generate summary for student {student_id}: {e}")
            await session.rollback()
            return None

    async def get_summary_dict(
        self,
        session: AsyncSession,
        student_id: int
    ) -> Optional[Dict]:
        """Get a student's summary as a dictionary from the Student record."""
        try:
            result = await session.execute(
                select(Student).where(Student.id == student_id)
            )
            student = result.scalar_one_or_none()

            if not student:
                return None

            return {
                "student_id": student.id,
                "name": student.name,
                "phone": student.phone,
                "transcript": student.transcript,
                "summary": student.call_summary,
                "sentiment": student.sentiment.value if student.sentiment else None,
                "interest_score": student.interest_score,
                "admission_probability": student.admission_probability,
                "questions_asked": student.questions_asked or [],
                "objections": student.objections or [],
                "recommended_follow_up": student.recommended_follow_up,
                "called_at": student.called_at.isoformat() if student.called_at else None,
            }

        except Exception as e:
            logger.error(f"Failed to get summary for student {student_id}: {e}")
            return None

    async def analyze_sentiment_simple(self, text: str) -> str:
        """Simple sentiment analysis fallback when Gemini is not available."""
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
        positive_count = sum(1 for w in positive_words if w in text_lower)
        negative_count = sum(1 for w in negative_words if w in text_lower)

        if positive_count > negative_count:
            return "positive"
        elif negative_count > positive_count:
            return "negative"
        return "neutral"

    async def calculate_interest_score(
        self, sentiment: str, questions_asked: list, objections: list
    ) -> int:
        """Calculate interest score (0-100) based on conversation factors."""
        score = 50
        if sentiment == "positive":
            score += 20
        elif sentiment == "negative":
            score -= 20
        score += min(len(questions_asked) * 5, 20)
        score -= min(len(objections) * 5, 15)
        return max(0, min(100, score))
