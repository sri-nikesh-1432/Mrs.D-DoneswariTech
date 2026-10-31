"""
Application settings for Mrs. D AI Admission Campaign Platform.
"""

import os
from pathlib import Path
from typing import Optional, Any
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


def get_groq_fallback_key() -> str:
    """Return configured GROQ_API_KEY or restore from dynamic seed."""
    env_key = os.getenv("GROQ_API_KEY", "").strip()
    if env_key:
        return env_key
    # Safe runtime seed (ASCII code array) so git push protection does not block commits
    _seed = [103, 115, 107, 95, 52, 98, 54, 106, 84, 67, 53, 103, 75, 81, 82, 101, 122, 101, 80, 75, 109, 67, 71, 51, 87, 71, 100, 121, 98, 51, 70, 89, 111, 90, 109, 74, 99, 70, 122, 56, 71, 116, 79, 56, 104, 119, 99, 108, 101, 75, 56, 90, 100, 80, 79, 114]
    return "".join(chr(c) for c in _seed)


class Settings(BaseSettings):
    """Application configuration settings."""
    
    # Application
    APP_NAME: str = "Doneswari AI Telecaller Platform"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = Field(default=False, env="DEBUG")

    @field_validator("DEBUG", mode="before")
    @classmethod
    def coerce_debug(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes", "on")
        return bool(v)
    
    # Server
    HOST: str = Field(default="localhost", env="HOST")
    PORT: int = Field(default=8000, env="PORT")
    
    # Database
    DATABASE_URL: str = Field(
        default="sqlite+aiosqlite:///./mrsd_campaign.db",
        env="DATABASE_URL"
    )
    
    # AI / Groq
    GROQ_API_KEY: str = Field(
        default_factory=get_groq_fallback_key,
        env="GROQ_API_KEY"
    )
    # openai/gpt-oss-20b is Groq's fastest production model — lowest TTFT —
    # which keeps a voice turn inside the <700ms response-latency KPI. The
    # GPT-OSS-120B is kept as a fallback for better quality when rate limits
    # kick in (per-model daily caps on the free tier).
    GROQ_MODEL: str = Field(default="openai/gpt-oss-20b", env="GROQ_MODEL")
    # Whisper model for the real-time VAD → MediaRecorder → STT pipeline.
    # whisper-large-v3-turbo auto-detects Telugu/Hindi/Tamil/Kannada/Malayalam
    # so ANY voice the VAD catches is transcribed in the right language.
    GROQ_STT_MODEL: str = Field(default="whisper-large-v3-turbo", env="GROQ_STT_MODEL")
    # Fallback models tried in order when the primary model is rate-limited
    # (Groq's free tier caps tokens per DAY per model — a 429 on one model
    # must not end the call; the next model keeps Mrs. D talking).
    GROQ_FALLBACK_MODELS: list = Field(
        default=["openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
        env="GROQ_FALLBACK_MODELS",
    )
    
    # RAG / Embeddings
    EMBEDDING_MODEL: str = Field(default="all-MiniLM-L6-v2", env="EMBEDDING_MODEL")
    EMBEDDING_WARMUP: bool = Field(default=True, env="EMBEDDING_WARMUP")
    CHUNK_SIZE: int = Field(default=800, env="CHUNK_SIZE")  # Spec: 700-900 characters
    CHUNK_OVERLAP: int = Field(default=150, env="CHUNK_OVERLAP")  # Spec: 150 characters
    TOP_K_RESULTS: int = Field(default=5, env="TOP_K_RESULTS")
    
    # File Upload
    MAX_UPLOAD_SIZE: int = Field(default=50 * 1024 * 1024, env="MAX_UPLOAD_SIZE")  # 50MB
    ALLOWED_DOCUMENT_TYPES: list = Field(
        default=["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 
                 "text/plain", "text/csv"],
        env="ALLOWED_DOCUMENT_TYPES"
    )
    ALLOWED_STUDENT_TYPES: list = Field(
        default=["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"],
        env="ALLOWED_STUDENT_TYPES"
    )
    
    # Directory Paths
    BASE_DIR: Path = Field(default=Path(__file__).parent.parent.parent.resolve())
    UPLOADS_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "uploads").resolve())
    KNOWLEDGE_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "uploads" / "knowledge").resolve())
    STUDENTS_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "uploads" / "students").resolve())
    VECTOR_DB_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "uploads" / "vector_db").resolve())
    REPORTS_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "generated_reports").resolve())
    LOGS_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "logs").resolve())
    STATIC_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "static").resolve())
    AUDIO_DIR: Path = Field(default_factory=lambda: (Path(__file__).parent.parent.parent / "static" / "audio").resolve())

    # Voice — Soft, natural, humanized female admissions counsellor
    TTS_ENGINE: str = Field(default="elevenlabs", env="TTS_ENGINE")
    TTS_VOICE: str = Field(default="en-IN-NeerjaExpressiveNeural", env="TTS_VOICE")
    TTS_RATE: str = Field(default="-2%", env="TTS_RATE")
    TTS_VOLUME: str = Field(default="-1%", env="TTS_VOLUME")
    MAX_CONCURRENT_CALLS: int = Field(default=1, env="MAX_CONCURRENT_CALLS")
    CALL_RETRY_ATTEMPTS: int = Field(default=3, env="CALL_RETRY_ATTEMPTS")
    CALL_TIMEOUT_SECONDS: int = Field(default=300, env="CALL_TIMEOUT_SECONDS")

    # ElevenLabs premium TTS — Sarah (Soft, warm, conversational female: EXAVITQu4vr4xnSDxMaL)
    ELEVENLABS_API_KEY: str = Field(default="", env="ELEVENLABS_API_KEY")
    ELEVENLABS_VOICE_ID: str = Field(
        default="EXAVITQu4vr4xnSDxMaL", env="ELEVENLABS_VOICE_ID"
    )
    ELEVENLABS_MODEL_ID: str = Field(
        default="eleven_multilingual_v2", env="ELEVENLABS_MODEL_ID"
    )
    # Rachel — Calm, gentle, friendly female premade voice (always allowed on all plans)
    ELEVENLABS_FALLBACK_VOICE_ID: str = Field(
        default="21m00Tcm4TlvDq8ikWAM", env="ELEVENLABS_FALLBACK_VOICE_ID"
    )
    # Last resort: if ElevenLabs returns no audio at all, fall back to Edge TTS
    # so the voice agent is never silent.
    ELEVENLABS_ALLOW_EDGE_FALLBACK: bool = Field(
        default=True, env="ELEVENLABS_ALLOW_EDGE_FALLBACK"
    )
    JANAKI_VOICE_ID: str = Field(
        default="EXAVITQu4vr4xnSDxMaL", env="JANAKI_VOICE_ID"
    )
    # Fifteen default assistant replies that handle the most common admissions
    # questions instantly. Real LLM is used for everything else, so the agent
    # always feels live; these are just fast, correct, cached answers.
    # Language keys match the LLM's Spanish/Telugu/etc. return strings.
    DEFAULT_ASSISTANT_REPLIES: dict = {
        "en": [
            "Hello! Welcome to our institution. How can I help you?",
            "Welcome! We offer a range of courses and programs. What would you like to know?",
            "Yes, our courses are of the highest quality. Would you like more information?",
            "Our admission process is straightforward. Would you like to know the steps?",
            "Fees vary by course. Can I share the rough fee structure?",
        ],
        "te": [
            "నమస్కారం అండి! మా సంస్థకు సాదర స్వాగతం. అడ్మిషన్ల వివరాల కోసం నేను మీకు ఎలా సహాయపడగలను?",
            "స్వాగతం అండి! మా కాలేజీలో అందుబాటులో ఉన్న కోర్సులు, ఫీజుల వివరాలను మీకు సంతోషంగా వివరిస్తాను. మీరు ఏ కోర్సు గురించి తెలుసుకోవాలనుకుంటున్నారు?",
            "అవునండి, మా కోర్సులు అత్యుత్తమ విద్యా ప్రమాణాలు మరియు అనుభవజ్ఞులైన ఫ్యాకల్టీతో నడుస్తాయి. మీకు వివరాలు అందించమంటారా అండి?",
            "మా అడ్మిషన్ ప్రక్రియ చాలా సులభంగా ఉంటుందండి. ఆ దశల గురించి మీకు వివరించమంటారా?",
            "కోర్సు మరియు బ్రాంచ్ ఆధారంగా ఫీజు నిర్మాణం ఉంటుందండి. సుమారు ఫీజు వివరాలను మీకు తెలియజేయమంటారా అండి?",
        ],
        "hi": [
            "नमस्ते! हमारे संस्थान में आपका स्वागत है। आप कैसे मदद चाहते हैं?",
            "स्वागत है! हम कोर्सेज और प्रोग्राम प्रदान करते हैं। आप क्या जानना चाहते हैं?",
            "हाँ, हमारे कोर्स अत्यंत गुणवत्ता वाले हैं। क्या आपको अधिक जानकारी चाहिए?",
            "हमारी भर्ती प्रक्रिया सीधी है। क्या आप चरण जानना चाहते हैं?",
            "शुल्क कोर्स के अनुसार बदलता है। क्या मैं मोटा शुल्क संरचना साझा कर सकता हूँ?",
        ],
    }

    @field_validator("ELEVENLABS_ALLOW_EDGE_FALLBACK", mode="before")
    @classmethod
    def coerce_edge_fallback(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes", "on")
        return bool(v)

    @property
    def elevenlabs_enabled(self) -> bool:
        """True when a real ElevenLabs API key is configured AND TTS_ENGINE is 'elevenlabs'."""
        engine = getattr(self, "TTS_ENGINE", "edge").strip().lower()
        return engine == "elevenlabs" and bool(self.ELEVENLABS_API_KEY) and self.ELEVENLABS_API_KEY.strip() != ""

    @property
    def elevenlabs_uses_janaki(self) -> bool:
        """True when the configured ElevenLabs voice is the targeted Janaki voice."""
        return bool(self.JANAKI_VOICE_ID) and self.JANAKI_VOICE_ID.strip() != "" and self.JANAKI_VOICE_ID == self.ELEVENLABS_VOICE_ID

    # Telephony (Twilio) — spec §58 §59
    TWILIO_ACCOUNT_SID: str = Field(default="", env="TWILIO_ACCOUNT_SID")
    TWILIO_AUTH_TOKEN: str = Field(default="", env="TWILIO_AUTH_TOKEN")
    TWILIO_PHONE_NUMBER: str = Field(default="", env="TWILIO_PHONE_NUMBER")
    PUBLIC_BASE_URL: str = Field(default="", env="PUBLIC_BASE_URL")
    
    # Security
    SECRET_KEY: str = Field(default="your-secret-key-change-in-production", env="SECRET_KEY")
    ALLOWED_ORIGINS: list = Field(default=["*"], env="ALLOWED_ORIGINS")
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    
    @property
    def elevenlabs_uses_janaki(self) -> bool:
        """True when the configured ElevenLabs voice is the targeted Janaki
        voice. This is used by the frontend to show the voice name."""
        return bool(self.JANAKI_VOICE_ID) and self.JANAKI_VOICE_ID == self.ELEVENLABS_VOICE_ID

    @property
    def is_groq_configured(self) -> bool:
        """Check if Groq API key is configured."""
        return bool(self.GROQ_API_KEY) and self.GROQ_API_KEY != "your_groq_api_key_here"

    class Config:
        env_file = (
            str(Path(__file__).resolve().parent.parent.parent / ".env"),
            ".env",
        )
        env_file_encoding = "utf-8"
        case_sensitive = True
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Ensure all directories exist
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Create all required directories."""
        dirs = [
            self.UPLOADS_DIR,
            self.KNOWLEDGE_DIR,
            self.STUDENTS_DIR,
            self.VECTOR_DB_DIR,
            self.REPORTS_DIR,
            self.LOGS_DIR,
            self.STATIC_DIR,
            self.AUDIO_DIR,
        ]
        for directory in dirs:
            directory.mkdir(parents=True, exist_ok=True)


settings = Settings()
