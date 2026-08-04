"""
Single Student Call API Routes - Handle individual student calls.
The AI Telecalling Agent uses the uploaded knowledge (via hidden RAG) to converse.
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone

from app.database.connection import get_database
from app.database.models import (
    Campaign, Student, Knowledge, CallLog,
    CallStatus, CallState, CampaignStatus, KnowledgeStatus
)
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
    Initiate a single student call with AI-powered conversation.
    The hidden RAG engine retrieves relevant knowledge so the AI can answer naturally.
    """
    try:
        # Get or create default campaign for single calls
        result = await session.execute(
            select(Campaign).where(Campaign.campaign_name == "Default Campaign")
        )
        campaign = result.scalar_one_or_none()

        if not campaign:
            campaign = Campaign(
                campaign_id=f"camp_{uuid.uuid4().hex[:12]}",
                campaign_name="Default Campaign",
                institute_name="Institute",
                status=CampaignStatus.PENDING,
                language="en",
                voice="en-IN-NeerjaNeural",
            )
            session.add(campaign)
            await session.commit()
            await session.refresh(campaign)

        # Check if knowledge base is ready
        knowledge_result = await session.execute(
            select(Knowledge).where(Knowledge.campaign_id == campaign.id)
        )
        knowledge = knowledge_result.scalar_one_or_none()

        if not knowledge or knowledge.status != KnowledgeStatus.READY:
            raise HTTPException(
                status_code=400,
                detail="Knowledge base not ready. Please upload institute knowledge first."
            )

        # Create temporary student record
        student = Student(
            campaign_id=campaign.id,
            name=student_name,
            phone=phone_number,
            call_status=CallStatus.DIALING,
            call_state=CallState.DIALING,
        )
        session.add(student)
        await session.commit()
        await session.refresh(student)

        # Initialize call log
        call_log = CallLog(
            student_id=student.id,
            campaign_id=campaign.id,
            call_status=CallStatus.DIALING,
            started_at=datetime.now(timezone.utc),
        )
        session.add(call_log)
        await session.commit()
        await session.refresh(call_log)

        # Generate initial greeting with RAG context
        context = await retrieve_context(
            f"Introduction call for student {student_name} interested in admission"
        )
        from app.rag.retriever import format_context_for_prompt
        context_str = format_context_for_prompt(context)

        system_prompt = (
            f"You are Mrs. D, an AI admission counselor for {campaign.institute_name}.\n"
            f"You are calling {student_name} to discuss admission opportunities.\n\n"
            f"Use the following knowledge about the institution to answer questions:\n"
            f"{context_str}\n\n"
            f"Be friendly, professional, and helpful. Start with a warm greeting."
        )

        greeting = await generate_response(
            conversation_history=[],
            context=system_prompt,
            user_message="Start the conversation"
        )

        # Generate audio for greeting
        voice_service = VoiceService()
        await voice_service.speak(greeting)

        # Get Twilio provider (mock in dev)
        twilio = get_twilio_provider()
        call_result = twilio.make_call(
            to_number=phone_number,
        )

        # Update call status
        if call_result.get("success"):
            student.call_status = CallStatus.CONNECTED
            call_log.call_status = CallStatus.CONNECTED
            campaign.calls_in_progress = (campaign.calls_in_progress or 0) + 1
        else:
            student.call_status = CallStatus.FAILED
            call_log.call_status = CallStatus.FAILED
            campaign.calls_failed = (campaign.calls_failed or 0) + 1

        await session.commit()

        return {
            "success": True,
            "student_id": student.id,
            "call_id": call_log.id,
            "status": student.call_status.value,
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
    Hidden RAG retrieves relevant knowledge for the AI.
    """
    try:
        result = await session.execute(
            select(CallLog).where(CallLog.id == call_id)
        )
        call_log = result.scalar_one_or_none()

        if not call_log:
            raise HTTPException(status_code=404, detail="Call not found")

        student_result = await session.execute(
            select(Student).where(Student.id == call_log.student_id)
        )
        student = student_result.scalar_one_or_none()

        # Update transcript
        call_log.transcript = (call_log.transcript or "") + f"\nStudent: {speech_text}"

        # Retrieve relevant context from hidden RAG
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
        system_prompt = (
            "You are Mrs. D, an AI admission counselor.\n"
            f"Use the following knowledge to answer the student's questions:\n{context}\n\n"
            "Be conversational, friendly, and helpful. Keep responses concise."
        )

        response = await generate_response(
            conversation_history=conversation_history,
            context=system_prompt,
            user_message=speech_text
        )

        call_log.transcript += f"\nMrs. D: {response}"

        # Convert response to speech
        voice_service = VoiceService()
        await voice_service.speak(response)

        await session.commit()

        return {
            "success": True,
            "response": response,
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
    Updates student call results and campaign statistics.
    """
    try:
        result = await session.execute(
            select(CallLog).where(CallLog.id == call_id)
        )
        call_log = result.scalar_one_or_none()

        if not call_log:
            raise HTTPException(status_code=404, detail="Call not found")

        # Update call log
        now = datetime.now(timezone.utc)
        call_log.call_status = CallStatus.COMPLETED
        call_log.ended_at = now
        if call_log.started_at:
            call_log.duration = int((now - call_log.started_at).total_seconds())

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
        if student and call_log.transcript:
            from app.reports.summary_service import SummaryService
            summary_service = SummaryService()
            await summary_service.generate_summary(
                session=session,
                student_id=student.id,
                transcript=call_log.transcript
            )

        if student:
            student.call_status = CallStatus.COMPLETED
            student.call_state = CallState.COMPLETED
            student.called_at = now
            student.call_duration = call_log.duration

        if campaign:
            campaign.calls_in_progress = max(0, (campaign.calls_in_progress or 0) - 1)
            campaign.calls_completed = (campaign.calls_completed or 0) + 1
            if call_log.duration:
                campaign.total_duration_seconds = (campaign.total_duration_seconds or 0) + call_log.duration

        await session.commit()

        return {
            "success": True,
            "duration": call_log.duration,
            "message": "Call ended and summary generated"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ending call: {e}")
        raise HTTPException(status_code=500, detail=str(e))
