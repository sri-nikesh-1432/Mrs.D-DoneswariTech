import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import enum

Base = declarative_base()


class TrainingStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    EXTRACTING = "extracting"
    CLEANING = "cleaning"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    PROFILE_GENERATION = "profile_generation"
    FAQ_GENERATION = "faq_generation"
    AGENT_CONFIGURATION = "agent_configuration"
    KNOWLEDGE_EVALUATION = "knowledge_evaluation"
    VOICE_CONFIGURATION = "voice_configuration"
    READY = "ready"
    FAILED = "failed"


class LeadStatus(str, enum.Enum):
    HOT = "hot"
    WARM = "warm"
    COLD = "cold"
    CALLBACK = "callback"
    NOT_INTERESTED = "not_interested"
    UNKNOWN = "unknown"


class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String)
    page_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    agent = relationship("Agent", back_populates="document", uselist=False)


class Agent(Base):
    __tablename__ = "agents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(String, ForeignKey("documents.id"))
    status = Column(String, default=TrainingStatus.UPLOADED)
    status_message = Column(String, default="")
    institution_profile = Column(JSON, default={})
    knowledge_stats = Column(JSON, default={})
    training_steps = Column(JSON, default=[])
    system_prompt = Column(Text, default="")
    elevenlabs_agent_id = Column(String, default="")
    voice_id = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    document = relationship("Document", back_populates="agent")
    conversations = relationship("Conversation", back_populates="agent")


class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"))
    chunk_index = Column(Integer)
    text = Column(Text)
    page = Column(Integer, default=0)
    section = Column(String, default="")
    category = Column(String, default="general")
    token_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"))
    caller_name = Column(String, default="")
    student_name = Column(String, default="")
    course_interest = Column(String, default="")
    language = Column(String, default="English")
    lead_status = Column(String, default=LeadStatus.UNKNOWN)
    lead_score = Column(Float, default=0.0)
    concern = Column(String, default="")
    duration_seconds = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    memory = Column(JSON, default={})
    agent = relationship("Agent", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation")


class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"))
    role = Column(String)  # user | assistant
    content = Column(Text)
    retrieved_chunks = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    conversation = relationship("Conversation", back_populates="messages")


class Lead(Base):
    __tablename__ = "leads"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"))
    agent_id = Column(String, ForeignKey("agents.id"))
    student_name = Column(String, default="")
    caller_name = Column(String, default="")
    course_interest = Column(String, default="")
    lead_status = Column(String, default=LeadStatus.UNKNOWN)
    concern = Column(String, default="")
    language = Column(String, default="English")
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
