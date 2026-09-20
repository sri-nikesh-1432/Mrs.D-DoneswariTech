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
    # Phone is optional in the model (spec §3 §45): a workspace may not have a
    # configured business number at creation time. Legacy SQLite DBs keep a
    # NOT NULL constraint — handled by the connection.py migration.
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

    # REAL extraction metadata (spec §4): measured from the actual uploaded
    # file — never estimated or fabricated. extraction_previews holds a JSON
    # sample of the extracted pages so the UI can show real text.
    page_count = Column(Integer, nullable=True)
    extracted_character_count = Column(Integer, nullable=True)
    extracted_word_count = Column(Integer, nullable=True)
    extraction_method = Column(String(50), nullable=True)
    extraction_status = Column(String(30), nullable=True)
    extraction_previews = Column(JSON, nullable=True)

    # Document versioning (spec §48): each re-upload creates a new version.
    # Only ONE version per agent is is_active — retrieval must never silently
    # serve stale embeddings after a knowledge update.
    document_version = Column(Integer, default=1, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    ingestion_stage = Column(String(50), nullable=True)  # extracting/chunking/embedding/indexing
    ingestion_error = Column(Text, nullable=True)

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
    call_attempt_count = Column(Integer, default=0)  # spec §35: retry logic guard

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

    # Real telephony metadata (spec §32): the provider's own call identifier
    # and provider name. A call initiated through Twilio/Exotel stores the
    # provider SID here — the frontend status reflects REAL provider events.
    provider = Column(String(50), nullable=True)  # twilio | exotel | web | none
    provider_call_id = Column(String(120), nullable=True, index=True)
    direction = Column(String(20), nullable=True)  # outbound | inbound | web

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


# ── Knowledge Chunks (spec §5 §8 §51) ───────────────────────────────────────

class KnowledgeChunk(Base):
    """
    Persisted knowledge chunk with retrieval metadata.
    Every embedded chunk is stored here so retrieval can report exactly where
    information came from (document, page, section, chunk) — spec §14.
    """
    __tablename__ = "knowledge_chunks"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("knowledge.id"), nullable=False, index=True)
    # Tenant + version provenance (spec §7): a chunk must always be traceable
    # back to the workspace and to the exact document version that produced
    # it, so stale knowledge can never be attributed to a new upload.
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=True, index=True)
    document_version_id = Column(Integer, nullable=True, index=True)

    chunk_id = Column(Integer, nullable=False)  # index within the document
    page_number = Column(Integer, nullable=True)
    section = Column(String(500), nullable=True)
    text = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=True)
    character_count = Column(Integer, nullable=True)
    embedding_model = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Transcript Messages (spec §36 §51) ──────────────────────────────────────

class TranscriptMessage(Base):
    """
    One message in a real call transcript. Every turn of every real
    conversation (voice WS or telephony) is persisted here — the transcript
    is NEVER fabricated by a script.
    """
    __tablename__ = "transcript_messages"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), ForeignKey("call_history.call_id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)

    sequence = Column(Integer, nullable=False)          # order in the call
    speaker = Column(String(20), nullable=False)        # agent | user
    text = Column(Text, nullable=False)
    language = Column(String(50), nullable=True)

    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    latency_ms = Column(Integer, nullable=True)         # per-turn total latency


# ── Call Events (spec §34 §51) ──────────────────────────────────────────────

class CallEvent(Base):
    """
    Real call lifecycle events from the telephony provider or voice pipeline:
    QUEUED → INITIATING → RINGING → ANSWERED → IN_PROGRESS → COMPLETED
    (or NO_ANSWER / BUSY / FAILED / REJECTED / CANCELLED).
    Frontend call status must be derived from these REAL events (spec §34 §63).
    """
    __tablename__ = "call_events"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), ForeignKey("call_history.call_id"), nullable=False, index=True)

    event_type = Column(String(50), nullable=False)     # queued|initiating|ringing|answered|in_progress|completed|no_answer|busy|failed
    source = Column(String(50), nullable=True)          # provider | pipeline | system
    provider_call_id = Column(String(120), nullable=True)
    detail = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Per-Turn Latency Records (spec §28 latency requirement) ───────────────

class TurnLatency(Base):
    """
    Measured latency for ONE conversational turn — never estimated.

    The KPI is response_latency_ms = first_audio_played - user_speech_end
    with a hard target of ≤ 700ms (spec: STRICT REALTIME VOICE LATENCY
    REQUIREMENT). One row per turn lets the dashboard compute real
    avg/median/P90/P95/max and the pass rate, per agent and per call.
    """
    __tablename__ = "turn_latencies"

    id = Column(Integer, primary_key=True, index=True)
    call_id = Column(String(64), ForeignKey("call_history.call_id"), nullable=False, index=True)
    agent_id = Column(Integer, ForeignKey("institutes.id"), nullable=False, index=True)
    turn_index = Column(Integer, nullable=False)

    # All timestamps in epoch milliseconds (measured, monotonic where possible)
    user_speech_start_ms = Column(Integer, nullable=True)
    user_speech_end_ms = Column(Integer, nullable=True)
    turn_detected_ms = Column(Integer, nullable=True)
    stt_start_ms = Column(Integer, nullable=True)
    stt_end_ms = Column(Integer, nullable=True)
    retrieval_start_ms = Column(Integer, nullable=True)
    retrieval_end_ms = Column(Integer, nullable=True)
    llm_start_ms = Column(Integer, nullable=True)
    llm_first_token_ms = Column(Integer, nullable=True)
    tts_start_ms = Column(Integer, nullable=True)
    tts_first_audio_ms = Column(Integer, nullable=True)
    first_audio_played_ms = Column(Integer, nullable=True)

    # Derived (measured): first_audio_played - user_speech_end
    response_latency_ms = Column(Integer, nullable=True, index=True)

    language = Column(String(50), nullable=True)
    source = Column(String(30), nullable=True)  # web | phone | dry_run
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Questions Ranking Analysis ─────────────────────────────────────────────

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
