from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TextChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, description="Unique session identifier")
    message: str = Field(..., min_length=1, max_length=2000, description="User message")
    return_audio: bool = Field(default=False, description="Whether to return TTS audio")


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ConversationLog(BaseModel):
    session_id: str
    question: str
    answer: str
    timestamp: datetime
    duration_ms: float
    input_type: str  # "voice" or "text"


class ChatResponse(BaseModel):
    session_id: str
    response: str
    audio_url: Optional[str] = None
    duration_ms: float
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    groq_connected: bool
    tts_available: bool
    timestamp: str
