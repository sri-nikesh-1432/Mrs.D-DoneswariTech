"""
Call Manager - Handles individual call state tracking and execution.
Coordinates between voice pipeline, AI, and telephony.
"""

import asyncio
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database.models import Student, CallLog, CallStatus, Campaign
from app.logs.logger import get_logger

logger = get_logger(__name__)


class CallManager:
    """Manages individual call lifecycle and state transitions."""
    
    def __init__(self):
        self.active_calls: Dict[int, Dict] = {}  # student_id -> call_info
        self.call_timers: Dict[int, asyncio.Task] = {}
    
    async def initiate_call(
        self,
        student: Student,
        campaign: Campaign,
        session: AsyncSession,
        voice_pipeline=None,
        ai_service=None
    ) -> bool:
        """
        Initiate a call to a student.
        
        Args:
            student: Student object
            campaign: Campaign object
            session: Database session
            voice_pipeline: Voice pipeline service
            ai_service: AI conversation service
            
        Returns:
            True if call initiated successfully
        """
        try:
            # Update student status to dialing
            student.call_status = CallStatus.DIALING
            student.call_attempts += 1
            await session.commit()
            
            # Create call log
            call_log = CallLog(
                campaign_id=campaign.id,
                student_id=student.id,
                call_status=CallStatus.DIALING,
                started_at=datetime.utcnow()
            )
            session.add(call_log)
            await session.commit()
            
            # Track active call
            self.active_calls[student.id] = {
                "student": student,
                "campaign": campaign,
                "call_log": call_log,
                "started_at": datetime.utcnow(),
                "transcript": [],
                "conversation_history": []
            }
            
            logger.info(f"Initiated call to {student.name} ({student.phone})")
            
            # Start call execution
            asyncio.create_task(
                self._execute_call(
                    student, campaign, session, voice_pipeline, ai_service
                )
            )
            
            return True
        
        except Exception as e:
            logger.error(f"Failed to initiate call to {student.name}: {e}")
            await session.rollback()
            return False
    
    async def _execute_call(
        self,
        student: Student,
        campaign: Campaign,
        session: AsyncSession,
        voice_pipeline=None,
        ai_service=None
    ):
        """
        Execute the call workflow.
        
        Args:
            student: Student object
            campaign: Campaign object
            session: Database session
            voice_pipeline: Voice pipeline service
            ai_service: AI conversation service
        """
        call_info = self.active_calls.get(student.id)
        if not call_info:
            return
        
        try:
            # Simulate call connection (in production, this would use telephony)
            await self._update_call_status(student, CallStatus.CONNECTED, session)
            await asyncio.sleep(1)
            
            # Greeting
            await self._update_call_status(student, CallStatus.SPEAKING, session)
            greeting = self._generate_greeting(student, campaign)
            
            if voice_pipeline:
                await voice_pipeline.speak(greeting)
            
            call_info["transcript"].append({"role": "ai", "text": greeting})
            call_info["conversation_history"].append({"role": "assistant", "content": greeting})
            
            await asyncio.sleep(2)
            
            # Main conversation loop
            max_turns = 10  # Maximum conversation turns
            turn_count = 0
            
            while turn_count < max_turns:
                # Listen to student
                await self._update_call_status(student, CallStatus.LISTENING, session)
                
                if voice_pipeline:
                    student_input = await voice_pipeline.listen(timeout=10)
                else:
                    # Simulate student input for testing
                    student_input = await self._simulate_student_input()
                
                if not student_input:
                    # Student didn't respond or hung up
                    logger.info(f"No response from {student.name}, ending call")
                    break
                
                call_info["transcript"].append({"role": "student", "text": student_input})
                call_info["conversation_history"].append({"role": "user", "content": student_input})
                
                # AI thinking
                await self._update_call_status(student, CallStatus.THINKING, session)
                
                if ai_service:
                    ai_response = await ai_service.chat(
                        query=student_input,
                        student_info={
                            "name": student.name,
                            "phone": student.phone,
                            "preferred_course": student.preferred_course
                        },
                        conversation_history=call_info["conversation_history"],
                        use_rag=True
                    )
                else:
                    ai_response = "Thank you for your interest. Our admissions team will follow up with more details."
                
                # AI speaking
                await self._update_call_status(student, CallStatus.SPEAKING, session)
                
                if voice_pipeline:
                    await voice_pipeline.speak(ai_response)
                
                call_info["transcript"].append({"role": "ai", "text": ai_response})
                call_info["conversation_history"].append({"role": "assistant", "content": ai_response})
                
                turn_count += 1
                await asyncio.sleep(1)
            
            # End call
            await self._complete_call(student, session, call_info)
        
        except Exception as e:
            logger.error(f"Error during call execution: {e}")
            await self._fail_call(student, session, str(e))
    
    async def _update_call_status(
        self,
        student: Student,
        status: CallStatus,
        session: AsyncSession
    ):
        """Update call status in database and notify via WebSocket."""
        student.call_status = status
        await session.execute(
            update(Student)
            .where(Student.id == student.id)
            .values(call_status=status)
        )
        await session.commit()
        
        # TODO: Notify via WebSocket
        logger.debug(f"Call status updated: {student.name} -> {status.value}")
    
    async def _complete_call(
        self,
        student: Student,
        session: AsyncSession,
        call_info: Dict
    ):
        """Mark call as completed and generate summary."""
        try:
            # Calculate duration
            duration = int((datetime.utcnow() - call_info["started_at"]).total_seconds())
            
            # Update student
            student.call_status = CallStatus.COMPLETED
            student.call_duration = duration
            student.called_at = datetime.utcnow()
            
            # Update call log
            call_info["call_log"].call_status = CallStatus.COMPLETED
            call_info["call_log"].duration = duration
            call_info["call_log"].ended_at = datetime.utcnow()
            
            await session.commit()
            
            # Generate summary
            from app.reports.summary_service import SummaryService
            summary_service = SummaryService()
            
            transcript_text = "\n".join([
                f"{t['role']}: {t['text']}" for t in call_info["transcript"]
            ])
            
            await summary_service.generate_summary(
                session=session,
                student_id=student.id,
                transcript=transcript_text
            )
            
            # Clean up
            del self.active_calls[student.id]
            
            logger.info(f"Call completed: {student.name} (Duration: {duration}s)")
        
        except Exception as e:
            logger.error(f"Error completing call: {e}")
    
    async def _fail_call(
        self,
        student: Student,
        session: AsyncSession,
        error_message: str
    ):
        """Mark call as failed."""
        try:
            student.call_status = CallStatus.FAILED
            
            if student.id in self.active_calls:
                call_info = self.active_calls[student.id]
                call_info["call_log"].call_status = CallStatus.FAILED
                call_info["call_log"].ended_at = datetime.utcnow()
            
            await session.commit()
            
            # Clean up
            if student.id in self.active_calls:
                del self.active_calls[student.id]
            
            logger.error(f"Call failed: {student.name} - {error_message}")
        
        except Exception as e:
            logger.error(f"Error marking call as failed: {e}")
    
    def _generate_greeting(self, student: Student, campaign: Campaign) -> str:
        """Generate personalized greeting for the student."""
        return (
            f"Hello! May I speak with {student.name}? "
            f"Hi {student.name}, I'm Mrs. D calling on behalf of {campaign.institute_name}. "
            f"Is this a good time to briefly discuss our admissions?"
        )
    
    async def _simulate_student_input(self) -> str:
        """Simulate student input for testing (remove in production)."""
        # This is for testing purposes - in production, this comes from actual voice input
        test_responses = [
            "Yes, I'm interested in learning more about your courses.",
            "What are the fees for the computer science program?",
            "Do you offer any scholarships?",
            "What about hostel facilities?",
            "Thank you for the information.",
            "I'd like to know more about placement opportunities."
        ]
        import random
        await asyncio.sleep(2)  # Simulate thinking time
        return random.choice(test_responses)
    
    def get_active_call_info(self, student_id: int) -> Optional[Dict]:
        """Get information about an active call."""
        return self.active_calls.get(student_id)
    
    def get_all_active_calls(self) -> List[Dict]:
        """Get all currently active calls."""
        return list(self.active_calls.values())


# Global call manager instance
call_manager = CallManager()
