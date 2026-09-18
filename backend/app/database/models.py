"""
Doneswari AI Telecaller Platform
Database Models for Multi-Tenant AI Voice Telecalling & Receptionist Platform
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

class AgentStatus(str, enum.Enum):
    DRAFT = "draft"
    PROCESSING = "processing"
    READY = "ready"
    TESTING = "testing"
    PUBLISHED = "published"
    PAUSED = "paused"


class KnowledgeStatus(str, enum.Enum):
    WAITING = "waiting"
    PROCESSING = "processing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    READY = "ready"
    ERROR = "error"


class CallStatus(str, enum.Enum):
    PENDING = "pending"
    CALLING = "calling"
    INCOMING = "incoming"
    ANSWERED = "answered"
    IN_PROGRESS = "in_progress"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    COMPLETED = "completed"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    FAILED = "failed"
    MISSED = "missed"
    CALLBACK_REQUESTED = "callback_requested"


class InterestLevel(str, enum.Enum):
    INTERESTED = "Interested"
    NOT_INTERESTED = "Not Interested"
    NEEDS_FOLLOW_UP = "Needs Follow-up"
    CALLBACK_REQUESTED = "Callback Requested"
    UNCLEAR = "Unclear"


class Sentiment(str, enum.Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    UNKNOWN = "unknown"


# ── Multi-Tenant Users & Workspaces ──────────────────────────────────────────

class User(Base):
    """
    User account in the Doneswari platform.
    Every user owns one or more isolated workspaces.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    company_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    workspaces = relationship("Workspace", back_populates="user", cascade="all, delete-orphan")


class Workspace(Base):
    """
    Isolated tenant workspace.
    Contains one or more agents, documents, and student datasets.
    """
    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="workspaces")
    agents = relationship("Institute", back_populates="workspace", cascade="all, delete-orphan")


# ── Institute / Agent ────────────────────────────────────────────────────────

class Institute(Base):
    """
    AI Telecaller Agent.
    Maintains isolated knowledge base, student contacts, call queue, and analytics.
    Table name kept as 'institutes' for full backward-compatibility with existing data.
    """
    __tablename__ = "institutes"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(String(64), unique=True, nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    # Agent Details
    name = Column(String(255), nullable=False)  # Institute / Organization name
    agent_name = Column(String(255), nullable=True, default="Aadhya")
    phone_number = Column(String(30), nullable=True, index=True)
    calling_purpose = Column(String(255), nullable=True, default="Admissions and Student Enquiry")
    description = Column(Text, nullable=True)

    # Voice & Language Configuration
    language = Column(String(50), default="en")
    voice = Column(String(100), default="en-IN-NeerjaNeural")
    voice_speed = Column(Float, default=1.0)
    greeting_message = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)

    # Lifecycle State: DRAFT, PROCESSING, READY, TESTING, PUBLISHED, PAUSED
    status = Column(String(50), default=AgentStatus.READY.value)

    # Aggregate Statistics
    total_students = Column(Integer, default=0)
    total_calls = Column(Integer, default=0)
    completed_calls = Column(Integer, default=0)
    missed_calls = Column(Integer, default=0)
    failed_calls = Column(Integer, default=0)
    interested_count = Column(Integer, default=0)
    not_interested_count = Column(Integer, default=0)
    follow_up_count = Column(Integer, default=0)
    callback_count = Column(Integer, default=0)
    total_duration_seconds = Column(Float, default=0.0)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    workspace = relationship("Workspace", back_populates="agents")
    knowledge = relationship("Knowledge", back_populates="institute", uselist=False, cascade="all, delete-orphan")
    calls = relationship("CallHistory", back_populates="institute", cascade="all, delete-orphan")
    students = relationship("Student", back_populates="agent", cascade="all, delete-orphan")
    question_rankings = relationship("QuestionRanking", back_populates="agent", cascade="all, delete-orphan")


# Aliases for agent/campaign semantic usage
Agent = Institute
Campaign = Institute
CampaignStatus = AgentStatus


# ── Knowledge Base ───────────────────────────────────────────────────────────

class Knowledge(Base):
    """
    Agent knowledge document.
    Processed through isolated RAG pipeline:
    Extract → Clean → Chunk → Embed → Store (Isolated FAISS per agent).
    """
    __tablename__ = "knowledge"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)

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


# ── Student Contact & Analytics Record ───────────────────────────────────────

class Student(Base):
    """
    Student contact record associated with an agent's campaign.
    Maintains calling state, conversation results, and interest analytics.
    """
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)
    campaign_id = Column(Integer, nullable=True)  # Backward compatibility

    # Identity
    name = Column(String(255), nullable=False)
    phone = Column(String(30), nullable=False, index=True)
    email = Column(String(255), nullable=True)
    preferred_course = Column(String(255), nullable=True)
    city = Column(String(255), nullable=True)
    state = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    # Calling Lifecycle
    call_status = Column(String(50), default="Pending")  # Pending, Calling, In Progress, Completed, No Answer, Busy, Failed, Callback Requested
    interest_level = Column(String(50), default="Unclear")  # Interested, Not Interested, Needs Follow-up, Callback Requested, Unclear
    duration_seconds = Column(Integer, default=0)

    # Extracted Conversation Intelligence
    questions_asked = Column(JSON, nullable=True)
    objections = Column(JSON, nullable=True)
    callback_requested = Column(Boolean, default=False)
    callback_time = Column(String(100), nullable=True)
    outcome = Column(String(255), nullable=True)
    last_called_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    agent = relationship("Institute", back_populates="students")
    calls = relationship("CallHistory", back_populates="student", cascade="all, delete-orphan")


# ── Call History ────────────────────────────────────────────────────────────

class CallHistory(Base):
    """
    Complete call record.
    Stores conversational transcript, analytics, and component latencies.
    """
    __tablename__ = "call_history"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), unique=True, nullable=False, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True, index=True)

    # Caller / Student information
    caller_number = Column(String(30), nullable=False, index=True)
    caller_name = Column(String(255), nullable=True)

    # Call details
    call_status = Column(String(50), default="completed", nullable=False)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=False)
    answered_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, default=0)

    # Conversation
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    detected_language = Column(String(50), nullable=True)
    questions_asked = Column(JSON, nullable=True)
    topics_discussed = Column(JSON, nullable=True)
    objections = Column(JSON, nullable=True)

    # AI Analysis & Controlled Categories
    interest_level = Column(String(50), default=InterestLevel.UNCLEAR.value)
    outcome = Column(String(255), nullable=True)
    callback_requested = Column(Boolean, default=False)
    sentiment = Column(SQLEnum(Sentiment), default=Sentiment.UNKNOWN, nullable=True)
    retrieved_chunks = Column(JSON, nullable=True)

    # Latency Observability (ms)
    avg_stt_time_ms = Column(Float, nullable=True)
    avg_retrieval_time_ms = Column(Float, nullable=True)
    avg_llm_response_time_ms = Column(Float, nullable=True)
    avg_tts_time_ms = Column(Float, nullable=True)
    total_latency_ms = Column(Float, nullable=True)
    total_turns = Column(Integer, default=0)

    # Recording & Audio
    recording_path = Column(String(500), nullable=True)
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    institute = relationship("Institute", back_populates="calls")
    student = relationship("Student", back_populates="calls")
    report = relationship("CallReport", back_populates="call", uselist=False, cascade="all, delete-orphan")


# ── Call Report ─────────────────────────────────────────────────────────────

class CallReport(Base):
    """
    Structured call report generated post-call.
    """
    __tablename__ = "call_reports"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), ForeignKey("call_history.call_id"), unique=True, nullable=False, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False)

    caller_name = Column(String(255), nullable=True)
    student_name = Column(String(255), nullable=True)
    student_class = Column(String(50), nullable=True)
    course = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    budget = Column(String(255), nullable=True)
    hostel = Column(String(50), nullable=True)
    transport = Column(String(50), nullable=True)

    interest_score = Column(Integer, default=0)
    conversion_probability = Column(Integer, default=0)
    intent = Column(String(20), default="COLD")
    lead_status = Column(String(20), default="NEW")

    objections = Column(JSON, nullable=True)
    next_action = Column(String(255), nullable=True)
    summary = Column(Text, nullable=True)
    questions_asked = Column(JSON, nullable=True)

    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    call = relationship("CallHistory", back_populates="report", uselist=False)


# ── Questions Ranking Analysis ───────────────────────────────────────────────

class QuestionRanking(Base):
    """
    Aggregates student questions asked across all calls.
    Enables organizational visibility into top questions.
    """
    __tablename__ = "question_rankings"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)
    question_text = Column(String(500), nullable=False)
    category = Column(String(100), nullable=True)
    count = Column(Integer, default=1)
    last_asked_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    agent = relationship("Institute", back_populates="question_rankings")


# ── Aggregate Analytics Cache ────────────────────────────────────────────────

class CallAnalytics(Base):
    """
    Cached aggregated analytics for dashboard performance.
    """
    __tablename__ = "call_analytics"

    id = Column(Integer, primary_key=True, index=True)
    institute_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, unique=True)

    total_calls = Column(Integer, default=0)
    today_calls = Column(Integer, default=0)
    completed_calls = Column(Integer, default=0)
    missed_calls = Column(Integer, default=0)

    avg_duration_seconds = Column(Float, default=0.0)
    total_duration_seconds = Column(Float, default=0.0)

    avg_retrieval_time_ms = Column(Float, default=0.0)
    avg_llm_response_time_ms = Column(Float, default=0.0)
    avg_stt_time_ms = Column(Float, default=0.0)
    avg_tts_time_ms = Column(Float, default=0.0)

    most_asked_questions = Column(JSON, nullable=True)
    top_retrieved_chunks = Column(JSON, nullable=True)
    knowledge_coverage = Column(Float, default=0.0)
    peak_hours = Column(JSON, nullable=True)

    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
