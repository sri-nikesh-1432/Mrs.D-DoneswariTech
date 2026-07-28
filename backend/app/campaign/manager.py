"""
Campaign Manager — Handles campaign lifecycle, student management, and calling.
This is the core orchestrator of the Mrs. D platform.
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.utils.logger import get_logger
from app.database import get_session_maker
from app.models import (
    Campaign, Student, KnowledgeDocument, CallLog, CallStatus, CallState,
    CampaignStatus, KnowledgeStatus, Sentiment
)
from app.rag.vector_store import vector_store
from app.rag.embeddings import generate_embeddings
from app.rag.chunker import chunk_text
from app.rag.retriever import is_knowledge_ready
from app.rag.gemini_service import chat, generate_summary

logger = get_logger(__name__)


# ── Campaign Management ──────────────────────────────────────────────────────

class CampaignManager:
    """Manages campaign lifecycle, student calling, and progress tracking."""

    def __init__(self):
        self._active_campaign_id: Optional[int] = None
        self._is_running: bool = False
        self._current_student_index: int = 0
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Not paused initially
        self._cancel_flag = False
        self._callbacks = []
        self._campaign_state = {
            "state": "idle",
            "current_student": None,
            "activity_feed": [],
        }

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def active_campaign_id(self) -> Optional[int]:
        return self._active_campaign_id

    def register_callback(self, callback):
        """Register a callback for state updates (e.g., WebSocket broadcast)."""
        self._callbacks.append(callback)

    async def _broadcast(self, event_type: str, data: Any):
        """Broadcast an update to all registered callbacks."""
        for callback in self._callbacks:
            try:
                await callback(event_type, data)
            except Exception as e:
                logger.error("Broadcast callback failed: %s", e)

    async def _add_activity(self, message: str, activity_type: str = "info"):
        """Add an activity feed entry."""
        entry = {
            "message": message,
            "type": activity_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self._campaign_state["activity_feed"].append(entry)
        # Keep only last 50 activities
        if len(self._campaign_state["activity_feed"]) > 50:
            self._campaign_state["activity_feed"] = self._campaign_state["activity_feed"][-50:]
        await self._broadcast("activity", entry)

    async def create_campaign(self, campaign_data: Dict) -> Dict:
        """Create a new campaign in the database."""
        session_maker = get_session_maker()
        async with session_maker() as session:
            campaign = Campaign(
                campaign_id=campaign_data.get("campaign_id", ""),
                campaign_name=campaign_data.get("campaign_name", "Untitled Campaign"),
                institute_name=campaign_data.get("institute_name", "Unknown Institute"),
                language=campaign_data.get("language", "en"),
                voice=campaign_data.get("voice", settings.TTS_VOICE),
                status=CampaignStatus.PENDING,
            )
            session.add(campaign)
            await session.commit()
            await session.refresh(campaign)
            logger.info("Campaign created: %s (ID: %d)", campaign.campaign_name, campaign.id)
            return {
                "id": campaign.id,
                "campaign_id": campaign.campaign_id,
                "campaign_name": campaign.campaign_name,
                "institute_name": campaign.institute_name,
                "status": campaign.status.value,
                "created_at": campaign.created_at.isoformat(),
            }

    # ── Knowledge Processing ──────────────────────────────────────────────────

    async def process_knowledge_document(
        self, campaign_id: int, filename: str, file_path: str, file_type: str, file_size: int
    ) -> Dict:
        """
        Process an uploaded knowledge document through the RAG pipeline.
        1. Extract text → 2. Clean → 3. Chunk → 4. Embed → 5. Store in FAISS
        """
        from app.rag.document_processor import extract_text, validate_file

        session_maker = get_session_maker()
        doc = None

        try:
            # Create knowledge document record
            async with session_maker() as session:
                doc = KnowledgeDocument(
                    campaign_id=campaign_id,
                    filename=filename,
                    file_type=file_type,
                    file_size=file_size,
                    status=KnowledgeStatus.PROCESSING,
                )
                session.add(doc)
                await session.commit()
                await session.refresh(doc)
                doc_id = doc.id

            await self._add_activity(f"Processing document: {filename}")

            # Step 1: Extract text
            async with session_maker() as session:
                doc_obj = await session.get(KnowledgeDocument, doc_id)
                doc_obj.status = KnowledgeStatus.PROCESSING
                await session.commit()

            text = await extract_text(file_path, filename)

            # Step 2: Clean text
            from app.rag.document_processor import clean_text
            text = clean_text(text)

            # Step 3: Chunk
            await self._add_activity(f"Chunking {filename}...")
            async with session_maker() as session:
                doc_obj = await session.get(KnowledgeDocument, doc_id)
                doc_obj.status = KnowledgeStatus.CHUNKING
                await session.commit()

            chunks = chunk_text(text, source_document=filename)

            # Step 4: Generate embeddings
            await self._add_activity(f"Generating embeddings for {len(chunks)} chunks...")
            async with session_maker() as session:
                doc_obj = await session.get(KnowledgeDocument, doc_id)
                doc_obj.status = KnowledgeStatus.EMBEDDING
                await session.commit()

            embeddings = generate_embeddings(chunks)

            # Step 5: Build FAISS index
            await self._add_activity(f"Building knowledge base...")
            vector_store.build_index(chunks, embeddings)

            # Update document status
            async with session_maker() as session:
                doc_obj = await session.get(KnowledgeDocument, doc_id)
                doc_obj.status = KnowledgeStatus.READY
                doc_obj.chunk_count = len(chunks)
                doc_obj.text_preview = text[:500]
                await session.commit()

            await self._add_activity(f"✅ Knowledge Base Ready — {len(chunks)} chunks indexed", "success")
            logger.info("Knowledge processing complete: %s (%d chunks)", filename, len(chunks))

            return {
                "success": True,
                "doc_id": doc_id,
                "chunk_count": len(chunks),
                "status": "ready",
            }

        except Exception as e:
            logger.error("Knowledge processing failed: %s", e)
            if doc and doc.id:
                async with session_maker() as session:
                    doc_obj = await session.get(KnowledgeDocument, doc.id)
                    if doc_obj:
                        doc_obj.status = KnowledgeStatus.FAILED
                        doc_obj.error_message = str(e)
                        await session.commit()
            await self._add_activity(f"❌ Knowledge processing failed: {str(e)}", "error")
            return {"success": False, "error": str(e)}

    # ── Student Management ────────────────────────────────────────────────────

    async def import_students(self, campaign_id: int, students_data: List[Dict]) -> Dict:
        """Import students from uploaded Excel/CSV data."""
        session_maker = get_session_maker()
        imported = 0
        skipped = 0
        errors = []

        async with session_maker() as session:
            campaign = await session.get(Campaign, campaign_id)
            if not campaign:
                return {"success": False, "error": "Campaign not found"}

            for student_data in students_data:
                name = student_data.get("name", "").strip()
                phone = student_data.get("phone", "").strip()

                if not name:
                    skipped += 1
                    errors.append(f"Row {imported + skipped}: Missing name")
                    continue
                if not phone:
                    skipped += 1
                    errors.append(f"Row {imported + skipped}: Missing phone for {name}")
                    continue

                # Basic phone validation
                phone = _clean_phone(phone)
                if not phone or len(phone) < 10:
                    skipped += 1
                    errors.append(f"Row {imported + skipped}: Invalid phone for {name}: {phone}")
                    continue

                student = Student(
                    campaign_id=campaign_id,
                    name=name,
                    phone=phone,
                    email=student_data.get("email", ""),
                    preferred_course=student_data.get("preferred_course", ""),
                    city=student_data.get("city", ""),
                    state=student_data.get("state", ""),
                    notes=student_data.get("notes", ""),
                    call_status=CallStatus.NOT_CALLED,
                )
                session.add(student)
                imported += 1

            # Update campaign student count
            campaign.total_students = imported
            await session.commit()

        await self._add_activity(f"📋 Imported {imported} students (skipped {skipped})", "success")
        logger.info("Student import: %d imported, %d skipped", imported, skipped)

        return {
            "success": True,
            "imported": imported,
            "skipped": skipped,
            "errors": errors[:10],  # Return first 10 errors
        }

    # ── Campaign Execution ────────────────────────────────────────────────────

    async def start_campaign(self, campaign_id: int) -> Dict:
        """Start the campaign — begins calling students sequentially."""
        if self._is_running:
            return {"success": False, "error": "A campaign is already running"}

        if not is_knowledge_ready():
            return {"success": False, "error": "Knowledge base is not ready"}

        session_maker = get_session_maker()
        async with session_maker() as session:
            campaign = await session.get(Campaign, campaign_id)
            if not campaign:
                return {"success": False, "error": "Campaign not found"}
            if campaign.total_students == 0:
                return {"success": False, "error": "No students to call"}

            campaign.status = CampaignStatus.RUNNING
            campaign.started_at = datetime.now(timezone.utc)
            await session.commit()

        self._active_campaign_id = campaign_id
        self._is_running = True
        self._cancel_flag = False
        self._current_student_index = 0
        self._pause_event.set()

        await self._add_activity(f"🚀 Campaign '{campaign.campaign_name}' started!", "success")

        # Start the campaign loop in the background
        asyncio.create_task(self._campaign_loop(campaign_id))

        return {"success": True, "message": "Campaign started"}

    async def _campaign_loop(self, campaign_id: int):
        """Main campaign loop — calls students sequentially."""
        try:
            session_maker = get_session_maker()

            while self._is_running and not self._cancel_flag:
                # Check pause
                await self._pause_event.wait()

                # Get next uncalled student
                async with session_maker() as session:
                    student = await self._get_next_student(session, campaign_id)

                    if student is None:
                        # All students processed
                        await self._complete_campaign(campaign_id)
                        return

                    # Mark as calling
                    student.call_status = CallStatus.CALLING
                    student.call_state = CallState.DIALING
                    await session.commit()
                    student_data = {
                        "id": student.id,
                        "name": student.name,
                        "phone": student.phone,
                        "preferred_course": student.preferred_course or "",
                        "city": student.city or "",
                    }

                await self._broadcast("student_calling", student_data)

                # Simulate the call (in production, this would use the telephony layer)
                await self._add_activity(f"📞 Calling {student_data['name']}...")

                try:
                    result = await self._simulate_call(session_maker, student.id, student_data, campaign_id)

                    # Update student with call results
                    async with session_maker() as session:
                        db_student = await session.get(Student, student.id)
                        if db_student:
                            db_student.call_status = CallStatus.COMPLETED
                            db_student.call_state = CallState.COMPLETED
                            db_student.duration_seconds = result.get("duration", 0)
                            db_student.sentiment = Sentiment(result.get("sentiment", "neutral"))
                            db_student.interest_score = result.get("interest_score", 0)
                            db_student.admission_probability = result.get("admission_probability", 0.0)
                            db_student.summary = result.get("summary", "")
                            db_student.transcript = result.get("transcript", "")
                            db_student.questions_asked = result.get("questions_asked", [])
                            db_student.objections = result.get("objections", [])
                            db_student.recommended_follow_up = result.get("recommended_follow_up", "")
                            db_student.called_at = datetime.now(timezone.utc)
                            if result.get("follow_up"):
                                db_student.call_status = CallStatus.RETRY

                            # Also update campaign counts
                            campaign = await session.get(Campaign, campaign_id)
                            if campaign:
                                campaign.calls_completed += 1
                                if result.get("interest_score", 0) >= 70:
                                    campaign.interested_count += 1
                                if result.get("follow_up"):
                                    campaign.follow_up_required += 1
                                campaign.total_duration_seconds += result.get("duration", 0)
                            await session.commit()

                    await self._add_activity(
                        f"✅ Call completed with {student_data['name']} — "
                        f"Sentiment: {result.get('sentiment', 'neutral')}, "
                        f"Interest: {result.get('interest_score', 0)}%",
                        "success"
                    )

                except Exception as e:
                    logger.error("Call failed for %s: %s", student_data['name'], e)
                    async with session_maker() as session:
                        db_student = await session.get(Student, student.id)
                        if db_student:
                            db_student.call_status = CallStatus.FAILED
                            db_student.call_state = CallState.FAILED
                            await session.commit()

                    async with session_maker() as session:
                        campaign = await session.get(Campaign, campaign_id)
                        if campaign:
                            campaign.calls_failed += 1
                            await session.commit()

                    await self._add_activity(f"❌ Call failed for {student_data['name']}: {str(e)}", "error")

                # Small delay between calls
                await asyncio.sleep(1)

        except Exception as e:
            logger.error("Campaign loop error: %s", e)
            await self._add_activity(f"⚠️ Campaign error: {str(e)}", "error")
        finally:
            self._is_running = False

    async def _get_next_student(self, session: AsyncSession, campaign_id: int):
        """Get the next uncalled student."""
        from sqlalchemy import select
        result = await session.execute(
            select(Student)
            .where(
                Student.campaign_id == campaign_id,
                Student.call_status == CallStatus.NOT_CALLED
            )
            .order_by(Student.id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _simulate_call(self, session_maker, student_id: int, student_data: Dict, campaign_id: int) -> Dict:
        """
        Simulate a call with the AI counselor.
        In production, this would connect to the telephony layer.
        """
        # Get conversation turns
        turns = [
            {"role": "user", "content": f"Hi, this is {student_data['name']} speaking."},
            {"role": "assistant", "content": f"Hello {student_data['name']}! I'm Mrs. D, calling on behalf of our institute. How are you today?"},
        ]

        # Simulate a few conversation turns
        simulated_questions = [
            "I'm good. Can you tell me about the courses you offer?",
            "What about the fee structure?",
        ]

        for question in simulated_questions:
            turns.append({"role": "user", "content": question})

            try:
                response = await chat(
                    query=question,
                    student_info=student_data,
                    conversation_history=turns[:-1],
                    use_rag=True,
                )
                turns.append({"role": "assistant", "content": response})
            except Exception as e:
                logger.error("Gemini response failed: %s", e)
                turns.append({"role": "assistant", "content": "I apologize, let me check that information for you."})

        # Generate summary
        transcript_text = "\n".join([
            f"{'Student' if t['role'] == 'user' else 'Mrs. D'}: {t['content']}"
            for t in turns
        ])

        summary = await generate_summary(transcript_text)

        # Create call log
        async with session_maker() as session:
            call_log = CallLog(
                student_id=student_id,
                campaign_id=campaign_id,
                state=CallState.COMPLETED,
                transcript=transcript_text,
                ai_response=json.dumps([t for t in turns if t['role'] == 'assistant']),
                duration_seconds=45.0 + (len(turns) * 15),
            )
            session.add(call_log)
            await session.commit()

        return {
            "duration": 45.0 + (len(turns) * 15),
            "transcript": transcript_text,
            "summary": summary.get("summary", ""),
            "sentiment": summary.get("sentiment", "neutral"),
            "interest_score": summary.get("interest_score", 50),
            "admission_probability": summary.get("admission_probability", 0.5),
            "questions_asked": summary.get("questions_asked", []),
            "objections": summary.get("objections", []),
            "recommended_follow_up": summary.get("recommended_follow_up", ""),
            "follow_up": summary.get("interest_score", 50) < 40,
        }

    async def pause_campaign(self) -> Dict:
        """Pause the running campaign."""
        if not self._is_running:
            return {"success": False, "error": "No campaign is running"}
        self._pause_event.clear()
        await self._add_activity("⏸️ Campaign paused", "warning")
        return {"success": True, "message": "Campaign paused"}

    async def resume_campaign(self) -> Dict:
        """Resume the paused campaign."""
        if not self._is_running:
            return {"success": False, "error": "No campaign is running"}
        self._pause_event.set()
        await self._add_activity("▶️ Campaign resumed", "success")
        return {"success": True, "message": "Campaign resumed"}

    async def cancel_campaign(self, campaign_id: int) -> Dict:
        """Cancel the running campaign."""
        self._cancel_flag = True
        self._is_running = False

        session_maker = get_session_maker()
        async with session_maker() as session:
            campaign = await session.get(Campaign, campaign_id)
            if campaign:
                campaign.status = CampaignStatus.CANCELLED
                await session.commit()

        await self._add_activity("⏹️ Campaign cancelled", "warning")
        return {"success": True, "message": "Campaign cancelled"}

    async def _complete_campaign(self, campaign_id: int):
        """Mark campaign as completed."""
        session_maker = get_session_maker()
        async with session_maker() as session:
            campaign = await session.get(Campaign, campaign_id)
            if campaign:
                campaign.status = CampaignStatus.COMPLETED
                campaign.finished_at = datetime.now(timezone.utc)
                await session.commit()

        self._is_running = False
        await self._add_activity("🏁 Campaign completed!", "success")
        logger.info("Campaign %d completed", campaign_id)

    # ── Dashboard Data ────────────────────────────────────────────────────────

    async def get_campaign_stats(self, campaign_id: int) -> Dict:
        """Get current campaign statistics."""
        session_maker = get_session_maker()
        async with session_maker() as session:
            campaign = await session.get(Campaign, campaign_id)
            if not campaign:
                return {"error": "Campaign not found"}

            avg_duration = 0
            if campaign.calls_completed > 0:
                avg_duration = campaign.total_duration_seconds / campaign.calls_completed

            return {
                "campaign_id": campaign.campaign_id,
                "campaign_name": campaign.campaign_name,
                "institute_name": campaign.institute_name,
                "status": campaign.status.value,
                "total_students": campaign.total_students,
                "calls_completed": campaign.calls_completed,
                "calls_failed": campaign.calls_failed,
                "calls_in_progress": campaign.calls_in_progress,
                "interested": campaign.interested_count,
                "follow_up_required": campaign.follow_up_required,
                "average_duration": round(avg_duration, 1),
                "knowledge_ready": is_knowledge_ready(),
                "progress": round(
                    (campaign.calls_completed + campaign.calls_failed) / max(campaign.total_students, 1) * 100, 1
                ),
                "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
                "finished_at": campaign.finished_at.isoformat() if campaign.finished_at else None,
            }

    async def get_students(self, campaign_id: int) -> List[Dict]:
        """Get all students for a campaign."""
        session_maker = get_session_maker()
        async with session_maker() as session:
            from sqlalchemy import select
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id).order_by(Student.id)
            )
            students = result.scalars().all()

            return [
                {
                    "id": s.id,
                    "name": s.name,
                    "phone": s.phone,
                    "email": s.email or "",
                    "preferred_course": s.preferred_course or "",
                    "city": s.city or "",
                    "status": s.call_status.value,
                    "call_state": s.call_state.value,
                    "duration": round(s.duration_seconds, 1),
                    "sentiment": s.sentiment.value if s.sentiment else "unknown",
                    "interest_score": s.interest_score,
                    "summary": s.summary or "",
                    "transcript": s.transcript or "",
                    "questions_asked": s.questions_asked or [],
                    "recommended_follow_up": s.recommended_follow_up or "",
                    "admission_probability": s.admission_probability,
                    "called_at": s.called_at.isoformat() if s.called_at else None,
                }
                for s in students
            ]


# ── Utility ───────────────────────────────────────────────────────────────────

def _clean_phone(phone: str) -> str:
    """Clean and validate phone number."""
    phone = phone.strip()
    # Remove non-digit characters except +
    phone = "".join(c for c in phone if c.isdigit() or c == "+")
    # Add +91 if missing (India)
    if phone.startswith("91") and len(phone) == 12:
        phone = "+" + phone
    elif len(phone) == 10:
        phone = "+91" + phone
    return phone


# Global singleton
campaign_manager = CampaignManager()
