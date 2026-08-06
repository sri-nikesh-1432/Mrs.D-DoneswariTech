"""
Mrs. D — AI Voice Receptionist Platform
Database Models for Incoming Call Management
"""

from sqlalchemy import (
    Column, String, Integer, Float, DateTime, Text, Boolean,
    ForeignKey, Enum as SQLEnum, JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime, timezone
import enum

from app.database.connection import Base


# ── Enums ────────────────────────────────────────────────────────────────────

class KnowledgeStatus(str, enum.Enum):
    WAITING = "waiting"
    PROCESSING = "processing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    READY = "ready"
    ERROR = "error"


class CallStatus(str, enum.Enum):
    INCOMING = "incoming"
    ANSWERED = "answered"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    COMPLETED = "completed"
    FAILED = "failed"
    MISSED = "missed"


class Sentiment(str, enum.Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    UNKNOWN = "unknown"


# ── Institute ───────────────────────────────────────────────────────────────

class Institute(Base):
    """
    Institute configuration.
    Each institute has its own knowledge base and phone number.
    """
    __tablename__ = "institutes"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(String(64), unique=True, nullable=False, index=True)
    
    # Institute details
    name = Column(String(255), nullable=False)
    phone_number = Column(String(20), nullable=False, unique=True, index=True)
    
    # Configuration
    language = Column(String(50), default="en")
    voice = Column(String(100), default="en-IN-NeerjaNeural")
    greeting_message = Column(Text, nullable=True)
    
    # Statistics
    total_calls = Column(Integer, default=0)
    completed_calls = Column(Integer, default=0)
    missed_calls = Column(Integer, default=0)
    total_duration_seconds = Column(Float, default=0.0)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    knowledge = relationship("Knowledge", back_populates="institute", uselist=False, cascade="all, delete-orphan")
    calls = relationship("CallHistory", back_populates="institute", cascade="all, delete-orphan")


# ── Knowledge ───────────────────────────────────────────────────────────────

class Knowledge(Base):
    """
    Institute knowledge document.
    Processed through RAG pipeline: Extract → Clean → Chunk → Embed → Store (FAISS).
    """
    __tablename__ = "knowledge"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False)

    document_name = Column(String(255), nullable=False)
    document_type = Column(String(50), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False)

    status = Column(SQLEnum(KnowledgeStatus), default=KnowledgeStatus.WAITING, nullable=False)
    chunks_count = Column(Integer, default=0)
    embedding_model = Column(String(100), nullable=True)

    processing_started_at = Column(DateTime(timezone=True), nullable=True)
    processing_completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    institute = relationship("Institute", back_populates="knowledge")


# ── Call History ────────────────────────────────────────────────────────────

class CallHistory(Base):
    """
    Complete incoming call record.
    Stores all call data including transcript, summary, analytics.
    """
    __tablename__ = "call_history"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), unique=True, nullable=False, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False)
    
    # Caller information
    caller_number = Column(String(20), nullable=False, index=True)
    caller_name = Column(String(255), nullable=True)
    
    # Call details
    call_status = Column(SQLEnum(CallStatus), default=CallStatus.INCOMING, nullable=False)
    
    # Timing
    started_at = Column(DateTime(timezone=True), nullable=False)
    answered_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, default=0)
    
    # Conversation
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    detected_language = Column(String(50), nullable=True)
    questions_asked = Column(JSON, nullable=True)  # List of questions
    topics_discussed = Column(JSON, nullable=True)  # List of topics
    
    # AI Analysis
    sentiment = Column(SQLEnum(Sentiment), default=Sentiment.UNKNOWN, nullable=True)
    retrieved_chunks = Column(JSON, nullable=True)  # Knowledge chunks used
    
    # Performance metrics
    avg_retrieval_time_ms = Column(Float, nullable=True)
    avg_llm_response_time_ms = Column(Float, nullable=True)
    avg_stt_time_ms = Column(Float, nullable=True)
    avg_tts_time_ms = Column(Float, nullable=True)
    total_turns = Column(Integer, default=0)
    
    # Recording
    recording_path = Column(String(500), nullable=True)
    
    # Error handling
    error_message = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    institute = relationship("Institute", back_populates="calls")


# ── Call Analytics ───────────────────────────────────────────────────────────

class CallAnalytics(Base):
    """
    Aggregated analytics for dashboard.
    Updated periodically for performance.
    """
    __tablename__ = "call_analytics"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, unique=True)
    
    # Call statistics
    total_calls = Column(Integer, default=0)
    today_calls = Column(Integer, default=0)
    completed_calls = Column(Integer, default=0)
    missed_calls = Column(Integer, default=0)
    
    # Duration statistics
    avg_duration_seconds = Column(Float, default=0.0)
    total_duration_seconds = Column(Float, default=0.0)
    
    # Performance metrics
    avg_retrieval_time_ms = Column(Float, default=0.0)
    avg_llm_response_time_ms = Column(Float, default=0.0)
    avg_stt_time_ms = Column(Float, default=0.0)
    avg_tts_time_ms = Column(Float, default=0.0)
    
    # Top questions
    most_asked_questions = Column(JSON, nullable=True)  # [{"question": "...", "count": 5}]
    
    # Knowledge usage
    top_retrieved_chunks = Column(JSON, nullable=True)  # [{"chunk_id": ..., "count": 5}]
    knowledge_coverage = Column(Float, default=0.0)  # Percentage of knowledge used
    unused_chunks = Column(JSON, nullable=True)  # List of unused chunk IDs
    
    # Peak calling hours
    peak_hours = Column(JSON, nullable=True)  # [{"hour": 10, "count": 15}]
    
    # Timestamps
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
