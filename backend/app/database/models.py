"""
Database models for Mrs. D AI Admission Campaign Platform.
"""

from sqlalchemy import Column, String, Integer, Float, DateTime, Text, Boolean, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum

from app.database.connection import Base


class CampaignStatus(str, enum.Enum):
    """Campaign status enumeration."""
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class CallStatus(str, enum.Enum):
    """Call status enumeration."""
    NOT_CALLED = "not_called"
    DIALING = "dialing"
    CONNECTED = "connected"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRY = "retry"


class Sentiment(str, enum.Enum):
    """Sentiment enumeration."""
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"


class KnowledgeStatus(str, enum.Enum):
    """Knowledge base status enumeration."""
    WAITING = "waiting"
    PROCESSING = "processing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    READY = "ready"
    ERROR = "error"


class Campaign(Base):
    """Campaign model representing an admission campaign."""
    
    __tablename__ = "campaigns"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_name = Column(String(255), nullable=False)
    institute_name = Column(String(255), nullable=False)
    status = Column(SQLEnum(CampaignStatus), default=CampaignStatus.PENDING, nullable=False)
    
    # Campaign configuration
    language = Column(String(50), default="en")
    voice = Column(String(100), default="en-US-AriaNeural")
    
    # Statistics
    total_students = Column(Integer, default=0)
    completed_calls = Column(Integer, default=0)
    failed_calls = Column(Integer, default=0)
    interested_students = Column(Integer, default=0)
    follow_up_required = Column(Integer, default=0)
    average_duration = Column(Float, default=0.0)
    
    # Timestamps
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    students = relationship("Student", back_populates="campaign", cascade="all, delete-orphan")
    knowledge = relationship("Knowledge", back_populates="campaign", uselist=False, cascade="all, delete-orphan")
    call_logs = relationship("CallLog", back_populates="campaign", cascade="all, delete-orphan")


class Student(Base):
    """Student model representing a prospective student."""
    
    __tablename__ = "students"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    
    # Student information
    name = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=False, index=True)
    email = Column(String(255), nullable=True)
    preferred_course = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    
    # Call information
    call_status = Column(SQLEnum(CallStatus), default=CallStatus.NOT_CALLED, nullable=False)
    call_duration = Column(Integer, default=0)  # in seconds
    call_attempts = Column(Integer, default=0)
    
    # AI analysis
    sentiment = Column(SQLEnum(Sentiment), nullable=True)
    interest_score = Column(Integer, nullable=True)  # 0-100
    admission_probability = Column(Float, nullable=True)  # 0.0-1.0
    
    # Timestamps
    called_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    campaign = relationship("Campaign", back_populates="students")
    call_log = relationship("CallLog", back_populates="student", uselist=False, cascade="all, delete-orphan")
    summary = relationship("Summary", back_populates="student", uselist=False, cascade="all, delete-orphan")


class Knowledge(Base):
    """Knowledge model representing institute knowledge base."""
    
    __tablename__ = "knowledge"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    
    # Document information
    document_name = Column(String(255), nullable=False)
    document_type = Column(String(50), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False)  # in bytes
    
    # Processing information
    status = Column(SQLEnum(KnowledgeStatus), default=KnowledgeStatus.WAITING, nullable=False)
    chunks_count = Column(Integer, default=0)
    embedding_model = Column(String(100), nullable=True)
    
    # Processing details
    processing_started_at = Column(DateTime(timezone=True), nullable=True)
    processing_completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Timestamps
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    campaign = relationship("Campaign", back_populates="knowledge")


class CallLog(Base):
    """Call log model representing individual call records."""
    
    __tablename__ = "call_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, unique=True)
    
    # Call information
    call_status = Column(SQLEnum(CallStatus), nullable=False)
    duration = Column(Integer, default=0)  # in seconds
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    
    # Call recording
    recording_path = Column(String(500), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    campaign = relationship("Campaign", back_populates="call_logs")
    student = relationship("Student", back_populates="call_log")


class Summary(Base):
    """Summary model representing AI-generated call summaries."""
    
    __tablename__ = "summaries"
    
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False, unique=True)
    
    # Summary content
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    sentiment = Column(SQLEnum(Sentiment), nullable=True)
    interest_score = Column(Integer, nullable=True)  # 0-100
    admission_probability = Column(Float, nullable=True)  # 0.0-1.0
    
    # AI analysis
    questions_asked = Column(Text, nullable=True)  # JSON array
    objections = Column(Text, nullable=True)  # JSON array
    recommended_course = Column(String(255), nullable=True)
    follow_up_required = Column(Boolean, default=False)
    follow_up_notes = Column(Text, nullable=True)
    
    # Timestamps
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    student = relationship("Student", back_populates="summary")


class Report(Base):
    """Report model representing generated campaign reports."""
    
    __tablename__ = "reports"
    
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    
    # Report information
    report_name = Column(String(255), nullable=False)
    report_type = Column(String(50), nullable=False)  # campaign, student, analytics
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False)  # in bytes
    
    # Report content (JSON for analytics)
    content = Column(Text, nullable=True)
    
    # Timestamps
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
