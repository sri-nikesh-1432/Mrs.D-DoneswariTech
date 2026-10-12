from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime


# ── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    document_id: str
    agent_id: str
    filename: str
    file_size: int


# ── Training ──────────────────────────────────────────────────────────────────

class TrainingProgress(BaseModel):
    step: int
    total: int
    message: str
    status: str
    percent: int


# ── Agent ─────────────────────────────────────────────────────────────────────

class AgentInfoResponse(BaseModel):
    agent_id: str
    status: str
    status_message: str
    institution_profile: Dict[str, Any]
    knowledge_stats: Dict[str, Any]
    system_prompt: str
    voice_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None


class KnowledgeSearchRequest(BaseModel):
    query: str
    top_k: int = 5


class KnowledgeSearchResult(BaseModel):
    text: str
    page: int
    section: str
    category: str
    score: float


class KnowledgeSearchResponse(BaseModel):
    query: str
    results: List[KnowledgeSearchResult]


# ── Conversation ──────────────────────────────────────────────────────────────

class StartConversationRequest(BaseModel):
    agent_id: str
    caller_name: Optional[str] = ""
    student_name: Optional[str] = ""
    course_interest: Optional[str] = ""
    language: Optional[str] = "English"


class StartConversationResponse(BaseModel):
    conversation_id: str
    agent_id: str
    system_prompt: str


class ChatRequest(BaseModel):
    message: str
    conversation_id: str


class ChatResponse(BaseModel):
    reply: str
    retrieved_chunks: List[Dict[str, Any]]
    lead_status: str
    memory: Dict[str, Any]


class EndConversationRequest(BaseModel):
    conversation_id: str


class EndConversationResponse(BaseModel):
    conversation_id: str
    lead_status: str
    lead_score: float
    duration_seconds: int
    memory: Dict[str, Any]


# ── Voice ─────────────────────────────────────────────────────────────────────

class VoiceSessionRequest(BaseModel):
    agent_id: str
    caller_name: Optional[str] = ""


class VoiceSessionResponse(BaseModel):
    session_id: str
    elevenlabs_agent_id: str
    voice_id: str
    signed_url: Optional[str] = None


# ── Leads ─────────────────────────────────────────────────────────────────────

class LeadResponse(BaseModel):
    id: str
    conversation_id: str
    agent_id: str
    student_name: str
    caller_name: str
    course_interest: str
    lead_status: str
    concern: str
    language: str
    notes: str
    created_at: datetime

    class Config:
        from_attributes = True


class LeadUpdateRequest(BaseModel):
    lead_status: Optional[str] = None
    notes: Optional[str] = None
    student_name: Optional[str] = None
    caller_name: Optional[str] = None
    course_interest: Optional[str] = None
