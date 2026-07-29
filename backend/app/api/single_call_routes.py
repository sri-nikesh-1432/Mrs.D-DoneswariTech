"""
Single Student Call API Routes - Handle individual student calls with RAG.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
import pandas as pd

from app.database.connection import get_database
from app.database.models import Campaign, Student, Knowledge, CallLog, CallStatus
from app.rag.retriever import retrieve_context
from app.rag.gemini_service import generate_response
from app.voice.voice_service import VoiceService
from app.telephony.twilio_provider import get_twilio_provider, TwilioProvider
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/single-call", tags=["Single Call"])


@router.post("/initiate")
async def initiate_single_call(
    student_name: str = Query(...),
    phone_number: str = Query(...),
    session: AsyncSession = Depends(get_database)
):
    """
    Initiate a single student call with RAG-powered conversation.
    
    This endpoint:
    1. Creates a temporary student record
    2. Retrieves relevant knowledge from RAG
    3. Initiates phone call via Twilio
    4. Manages conversation flow
    """
    try:
        # Get or create default campaign for single calls
        result = await session.execute(
            select(Campaign).where(Campaign.campaign_id == "default_single_call")
        )
        campaign = result.scalar_one_or_none()
        
        if not campaign:
            # Create default campaign
            campaign = Campaign(
                campaign_id="default_single_call",
                campaign_name="Single Student Call Campaign",
                institute_name="Default Institute",
                status="pending",
                language="en",
                voice="en-US-AriaNeural",
                total_students=0,
                calls_completed=0,
                calls_failed=0,
                calls_in_progress=0,
                interested=0,
                follow_up_required=0,
                average_duration=0,
                knowledge_ready=False,
                progress=0
            )
            session.add(campaign)
            await session.commit()
            await session.refresh(campaign)
        
        # Check if knowledge base is ready
        knowledge_result = await session.execute(
            select(Knowledge).where(Knowledge.campaign_id == campaign.id)
        )
        knowledge = knowledge_result.scalar_one_or_none()
        
        if not knowledge or knowledge.status.value != "ready":
            raise HTTPException(
                status_code=400,
                detail="Knowledge base not ready. Please upload institute knowledge first."
            )
        
        # Create temporary student record
        student = Student(
            campaign_id=campaign.id,
            name=student_name,
            phone=phone_number,
            email="",
            preferred_course="",
            city="",
            status="not_called",
            call_state="pending",
            duration=0,
            sentiment="unknown",
            interest_score=0,
            summary="",
            transcript="",
            questions_asked=[],
            recommended_follow_up="",
            admission_probability=0,
            called_at=None
        )
        session.add(student)
        await session.commit()
        await session.refresh(student)
        
        # Initialize call log
        call_log = CallLog(
            student_id=student.id,
            campaign_id=campaign.id,
            status=CallStatus.INITIATED,
            started_at=pd.Timestamp.utcnow(),
            transcript="",
            sentiment="unknown",
            interest_score=0
        )
        session.add(call_log)
        await session.commit()
        await session.refresh(call_log)
        
        # Get Twilio provider
        twilio = get_twilio_provider()
        
        # Generate initial greeting with RAG context
        context = await retrieve_context(
            f"Introduction call for student {student_name} interested in admission"
        )
        
        system_prompt = f"""You are Mrs. D, an AI admission counselor for {campaign.institute_name}.
You are calling {student_name} to discuss admission opportunities.

Use the following knowledge about the institution to answer questions:
{context}

Be friendly, professional, and helpful. Start with a warm greeting and ask about their interests."""
        
        greeting = await generate_response(
            conversation_history=[],
            context=system_prompt,
            user_message="Start the conversation"
        )
        
        # Generate audio for greeting
        voice_service = VoiceService()
        greeting_audio = await voice_service.text_to_speech(greeting)
        
        # Initiate Twilio call
        call_result = twilio.make_call(
            to_number=phone_number,
            twiml=twilio.generate_twiml(greeting) if isinstance(twilio, TwilioProvider) else None
        )
        
        # Update call log
        call_log.call_sid = call_result.get("call_sid")
        call_log.status = CallStatus.IN_PROGRESS if call_result.get("success") else CallStatus.FAILED
        await session.commit()
        
        # Update student status
        if call_result.get("success"):
            student.status = "calling"
            student.call_state = "in_progress"
            campaign.calls_in_progress += 1
        else:
            student.status = "failed"
            student.call_state = "failed"
            campaign.calls_failed += 1
        
        await session.commit()
        
        logger.info(f"Single call initiated for student {student.id} (Call SID: {call_result.get('call_sid')})")
        
        return {
            "success": True,
            "student_id": student.id,
            "call_id": call_log.id,
            "call_sid": call_result.get("call_sid"),
            "status": call_result.get("status"),
            "greeting": greeting,
            "message": "Call initiated successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error initiating single call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/process-speech")
async def process_speech(
    call_id: int = Query(...),
    speech_text: str = Query(...),
    session: AsyncSession = Depends(get_database)
):
    """
    Process student speech during call and generate AI response.
    
    This endpoint:
    1. Retrieves relevant knowledge from RAG
    2. Generates AI response using Gemini
    3. Converts response to speech
    4. Updates conversation history
    """
    try:
        # Get call log
        result = await session.execute(
            select(CallLog).where(CallLog.id == call_id)
        )
        call_log = result.scalar_one_or_none()
        
        if not call_log:
            raise HTTPException(status_code=404, detail="Call not found")
        
        # Get student
        student_result = await session.execute(
            select(Student).where(Student.id == call_log.student_id)
        )
        student = student_result.scalar_one_or_none()
        
        # Update transcript
        call_log.transcript += f"\nStudent: {speech_text}"
        
        # Retrieve relevant context from RAG
        context = await retrieve_context(speech_text)
        
        # Get conversation history
        conversation_history = []
        if call_log.transcript:
            lines = call_log.transcript.split('\n')
            for line in lines:
                if line.startswith('Mrs. D:'):
                    conversation_history.append({"role": "assistant", "content": line[7:]})
                elif line.startswith('Student:'):
                    conversation_history.append({"role": "user", "content": line[8:]})
        
        # Generate AI response
        system_prompt = f"""You are Mrs. D, an AI admission counselor.
Use the following knowledge to answer the student's questions:
{context}

Be conversational, friendly, and helpful. Keep responses concise and engaging."""
        
        response = await generate_response(
            conversation_history=conversation_history,
            context=system_prompt,
            user_message=speech_text
        )
        
        # Update transcript
        call_log.transcript += f"\nMrs. D: {response}"
        
        # Convert response to speech
        voice_service = VoiceService()
        audio_data = await voice_service.text_to_speech(response)
        
        await session.commit()
        
        return {
            "success": True,
            "response": response,
            "audio_data": audio_data,
            "context_used": context[:500] if context else "No context"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing speech: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/end-call")
async def end_call(
    call_id: int = Query(...),
    session: AsyncSession = Depends(get_database)
):
    """
    End a call and generate summary.
    
    This endpoint:
    1. Hangs up the phone call
    2. Generates call summary with sentiment analysis
    3. Updates student and campaign statistics
    """
    try:
        # Get call log
        result = await session.execute(
            select(CallLog).where(CallLog.id == call_id)
        )
        call_log = result.scalar_one_or_none()
        
        if not call_log:
            raise HTTPException(status_code=404, detail="Call not found")
        
        # Hang up Twilio call if active
        if call_log.call_sid:
            twilio = get_twilio_provider()
            twilio.hangup_call(call_log.call_sid)
        
        # Update call log
        call_log.status = CallStatus.COMPLETED
        call_log.ended_at = pd.Timestamp.utcnow()
        call_log.duration = (call_log.ended_at - call_log.started_at).total_seconds()
        
        # Get student and campaign
        student_result = await session.execute(
            select(Student).where(Student.id == call_log.student_id)
        )
        student = student_result.scalar_one_or_none()
        
        campaign_result = await session.execute(
            select(Campaign).where(Campaign.id == call_log.campaign_id)
        )
        campaign = campaign_result.scalar_one_or_none()
        
        # Generate summary using AI
        from app.reports.summary_service import SummaryService
        summary_service = SummaryService()
        summary = await summary_service.generate_summary(
            transcript=call_log.transcript,
            student_name=student.name if student else "Unknown"
        )
        
        # Update student with summary data
        if student:
            student.summary = summary.get("summary", "")
            student.sentiment = summary.get("sentiment", "neutral")
            student.interest_score = summary.get("interest_score", 0)
            student.questions_asked = summary.get("questions_asked", [])
            student.recommended_follow_up = summary.get("follow_up_required", "")
            student.admission_probability = summary.get("admission_probability", 0)
            student.status = "completed"
            student.call_state = "completed"
            student.called_at = pd.Timestamp.utcnow()
            student.duration = call_log.duration
        
        # Update campaign statistics
        if campaign:
            campaign.calls_in_progress -= 1
            campaign.calls_completed += 1
            if student and student.interest_score >= 70:
                campaign.interested += 1
            if student and student.recommended_follow_up:
                campaign.follow_up_required += 1
            campaign.average_duration = (
                (campaign.average_duration * (campaign.calls_completed - 1) + call_log.duration) /
                campaign.calls_completed
            )
            campaign.progress = (campaign.calls_completed / campaign.total_students * 100) if campaign.total_students > 0 else 0
        
        await session.commit()
        
        logger.info(f"Call {call_id} ended successfully")
        
        return {
            "success": True,
            "summary": summary,
            "duration": call_log.duration,
            "message": "Call ended and summary generated"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ending call: {e}")
        raise HTTPException(status_code=500, detail=str(e))
