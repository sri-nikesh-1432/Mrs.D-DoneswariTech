"""
Application settings for Mrs. D AI Admission Campaign Platform.
"""

import os
from pathlib import Path
from typing import Optional, Any
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


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
    GROQ_API_KEY: str = Field(default="", env="GROQ_API_KEY")
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
        default=["openai/gpt-oss-120b"],
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

    # Voice — Janaki, the premium Indian female neural voice from ElevenLabs.
    # The agent's live voice is driven by ELEVENLABS_VOICE_ID (ElevenLabs engine),
    # NOT the Edge-TTS default below. Set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID
    # in .env to let the agent speak with Janaki.
    # Voice is chosen at runtime from the agent's `voice` field (a premade
    # ElevenLabs id = Janaki when configured, otherwise a regional Edge voice).
    TTS_VOICE: str = Field(default="en-IN-NeerjaNeural", env="TTS_VOICE")
    TTS_RATE: str = Field(default="+7%", env="TTS_RATE")
    TTS_VOLUME: str = Field(default="+1%", env="TTS_VOLUME")
    MAX_CONCURRENT_CALLS: int = Field(default=1, env="MAX_CONCURRENT_CALLS")
    CALL_RETRY_ATTEMPTS: int = Field(default=3, env="CALL_RETRY_ATTEMPTS")
    CALL_TIMEOUT_SECONDS: int = Field(default=300, env="CALL_TIMEOUT_SECONDS")

    # ElevenLabs premium TTS — when the API key is set, the voice agent
    # speaks with an ElevenLabs voice instead of Edge TTS.
    ELEVENLABS_API_KEY: str = Field(default="", env="ELEVENLABS_API_KEY")
    # Default ElevenLabs voice id. The project targets Janaki (a warm noted
    # Indian female voice). Because the Janaki library voice requires a paid
    # plan and can return HTTP 402 on a Free account, the default below is the
    # premade fallback that works on every plan. Set ELEVENLABS_VOICE_ID to a
    # Janaki voice id in .env to use it; the ElevenLabs service will fall
    # back automatically if the chosen voice is not permitted.
    ELEVENLABS_VOICE_ID: str = Field(
        default="hpp4J3VqNfWAUOO0d1Us", env="ELEVENLABS_VOICE_ID"
    )
    ELEVENLABS_MODEL_ID: str = Field(
        default="eleven_turbo_v2_5", env="ELEVENLABS_MODEL_ID"
    )
    # Fallback premade voice used when the chosen voice is not permitted for
    # this ElevenLabs plan (a library voice on a Free account returns HTTP 402
    # "paid_plan_required"). Premade voices are always allowed on every plan.
    # Bella — Professional, Bright, Warm (female).
    ELEVENLABS_FALLBACK_VOICE_ID: str = Field(
        default="hpp4J3VqNfWAUOO0d1Us", env="ELEVENLABS_FALLBACK_VOICE_ID"
    )
    # Last resort: if ElevenLabs returns no audio at all, fall back to Edge TTS
    # so the voice agent is never silent.
    ELEVENLABS_ALLOW_EDGE_FALLBACK: bool = Field(
        default=True, env="ELEVENLABS_ALLOW_EDGE_FALLBACK"
    )
    # Best-effort ElevenLabs voice detection. If the ELEVENLABS_VOICE_ID is a
    # premade voice (no dashes, no dots), it is assumed to be a known-premade
    # voice that works on a Free plan. Configure a Janaki voice id here to lock
    # the agent's live voice to Janaki's Telugu voice (elevenlabs.io/voices/).
    JANAKI_VOICE_ID: str = Field(
        default="0U7pUcfIxJzwwTseQz75", env="JANAKI_VOICE_ID"
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
            "హలో! మా సంస్థకు స్వాగతం. నేను ఇక్కడ ఉన్నాను. మీరు ఏమి సహాయం కావాలనుకుంటున్నారు?",
            "స్వాగతం! మీకు ఎలా సహాయం చేయగలను? మా కోర్సుల గురించి మరియు ప్రోగ్రామ్‌ల గురించి మీకు తెలుసుకోవాలనుకుంటున్నాము.",
            "అవును, మా కోర్సులు మిక్కిలి ఉన్నత నాణ్యతను కలిగి ఉంటాయి. మీకు అదనపు సమాచారం అవసరంగా ఉందా?",
            "మా అడ్మిషన్ ప్రక్రియ సరళంగా ఉంటుంది. దశలు తెలుసుకోవాలనుకుంటున్నారా?",
            "చదువుల ఆధారంగా చెల్లింపులు మారుతాయి. సుమారు చెల్లింపు నిర్మాణాన్ని పంచుకోవచ్చా?",
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
        """True when a real ElevenLabs API key is configured."""
        return bool(self.ELEVENLABS_API_KEY) and self.ELEVENLABS_API_KEY.strip() != ""

    @property
    def elevenlabs_uses_janaki(self) -> bool:
        """True when the configured ElevenLabs voice is the targeted Janaki voice."""
        return bool(self.JANAKI_VOICE_ID) and self.JANAKI_VOICE_ID.strip() != "" and self.JANAKI_VOICE_ID == self.ELEVENLABS_VOICE_ID

    # Telephony (Twilio) — spec §58 §59
    TWILIO_ACCOUNT_SID: str = Field(default="", env="TWILIO_ACCOUNT_SID")
    TWILIO_AUTH_TOKEN: str = Field(default="", env="TWILIO_AUTH_TOKEN")
    TWILIO_PHONE_NUMBER: str = Field(default="", env="TWILIO_PHONE_NUMBER")
    
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
