"""
SQLAlchemy ORM models for the Mrs. D platform.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Text, Float, DateTime, ForeignKey,
    Enum as SAEnum, JSON, Boolean, LargeBinary
)
from sqlalchemy.orm import relationship
from app.database import Base
import enum


# ── Enums ────────────────────────────────────────────────────────────────────

class CampaignStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class KnowledgeStatus(str, enum.Enum):
    WAITING = "waiting"
    PROCESSING = "processing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    READY = "ready"
    FAILED = "failed"


class CallStatus(str, enum.Enum):
    NOT_CALLED = "not_called"
    CALLING = "calling"
    CONNECTED = "connected"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRY = "retry"


class CallState(str, enum.Enum):
    WAITING = "waiting"
    DIALING = "dialing"
    GREETING = "greeting"
    INTRODUCTION = "introduction"
    PROMOTION = "promotion"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    COMPLETED = "completed"
    FAILED = "failed"


class Sentiment(str, enum.Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"


# ── Models ────────────────────────────────────────────────────────────────────

class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(String(64), unique=True, nullable=False, index=True)
    campaign_name = Column(String(255), nullable=False)
    institute_name = Column(String(255), nullable=False)
    status = Column(SAEnum(CampaignStatus), default=CampaignStatus.PENDING)
    language = Column(String(10), default="en")
    voice = Column(String(100), default="en-IN-NeerjaNeural")

    total_students = Column(Integer, default=0)
    calls_completed = Column(Integer, default=0)
    calls_failed = Column(Integer, default=0)
    calls_in_progress = Column(Integer, default=0)
    interested_count = Column(Integer, default=0)
    follow_up_required = Column(Integer, default=0)
    total_duration_seconds = Column(Float, default=0.0)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)

    students = relationship("Student", back_populates="campaign", cascade="all, delete-orphan")
    knowledge_docs = relationship("KnowledgeDocument", back_populates="campaign", cascade="all, delete-orphan")


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_type = Column(String(10), nullable=False)
    file_size = Column(Integer, default=0)
    status = Column(SAEnum(KnowledgeStatus), default=KnowledgeStatus.WAITING)
    chunk_count = Column(Integer, default=0)
    text_preview = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    campaign = relationship("Campaign", back_populates="knowledge_docs")


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    name = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=False)
    email = Column(String(255), nullable=True)
    preferred_course = Column(String(255), nullable=True)
    city = Column(String(255), nullable=True)
    state = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    call_status = Column(SAEnum(CallStatus), default=CallStatus.NOT_CALLED)
    call_state = Column(SAEnum(CallState), default=CallState.WAITING)
    duration_seconds = Column(Float, default=0.0)
    sentiment = Column(SAEnum(Sentiment), nullable=True)
    interest_score = Column(Integer, default=0)  # 0-100
    admission_probability = Column(Float, default=0.0)  # 0.0-1.0
    summary = Column(Text, nullable=True)
    transcript = Column(Text, nullable=True)
    questions_asked = Column(JSON, nullable=True)
    objections = Column(JSON, nullable=True)
    recommended_follow_up = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    called_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    campaign = relationship("Campaign", back_populates="students")
    call_logs = relationship("CallLog", back_populates="student", cascade="all, delete-orphan")


class CallLog(Base):
    __tablename__ = "call_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    state = Column(SAEnum(CallState), default=CallState.WAITING)
    transcript = Column(Text, nullable=True)
    ai_response = Column(Text, nullable=True)
    audio_url = Column(String(512), nullable=True)
    duration_seconds = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    student = relationship("Student", back_populates="call_logs")


class CampaignReport(Base):
    __tablename__ = "campaign_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    report_type = Column(String(50), default="full")
    pdf_path = Column(String(512), nullable=True)
    summary_data = Column(JSON, nullable=True)
    generated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
