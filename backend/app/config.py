"""
Mrs. D — Application Configuration
Loads settings from .env using pydantic-settings.
"""

import os
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── Gemini AI ────────────────────────────────────────────────
    GEMINI_API_KEY: str = Field(default="", description="Google Gemini API key")
    GEMINI_MODEL: str = Field(default="gemini-2.0-flash")

    # ── Server ────────────────────────────────────────────────────
    HOST: str = Field(default="localhost")
    PORT: int = Field(default=8000)

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./mrsd.db")

    # ── Frontend ──────────────────────────────────────────────────
    FRONTEND_PORT: int = Field(default=5175)

    # ── Voice ─────────────────────────────────────────────────────
    STT_PROVIDER: str = Field(default="whisper")
    TTS_PROVIDER: str = Field(default="edge-tts")
    TTS_VOICE: str = Field(default="en-IN-NeerjaNeural")
    TTS_VOICE_MAP: dict = {
        "en": "en-IN-NeerjaNeural",
        "te": "te-IN-ShrutiNeural",
        "hi": "hi-IN-SwaraNeural",
        "ta": "ta-IN-PallaviNeural",
    }

    # ── RAG ───────────────────────────────────────────────────────
    EMBEDDING_MODEL: str = Field(default="all-MiniLM-L6-v2")
    CHUNK_SIZE: int = Field(default=800)
    CHUNK_OVERLAP: int = Field(default=150)
    TOP_K_RETRIEVAL: int = Field(default=5)

    # ── Session ───────────────────────────────────────────────────
    SESSION_TIMEOUT_MINUTES: int = Field(default=30)
    MAX_HISTORY_TURNS: int = Field(default=20)

    # ── Campaign ──────────────────────────────────────────────────
    MAX_CALL_RETRIES: int = Field(default=3)
    CALL_TIMEOUT_SECONDS: int = Field(default=120)

    # ── Logging ───────────────────────────────────────────────────
    LOG_LEVEL: str = Field(default="INFO")

    # ── Uploads ───────────────────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = Field(default=50)

    # ── Derived Paths ─────────────────────────────────────────────
    @property
    def BASE_DIR(self) -> str:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @property
    def APP_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "app")

    @property
    def UPLOADS_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "uploads")

    @property
    def REPORTS_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "generated_reports")

    @property
    def LOGS_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "logs")

    @property
    def STATIC_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "static")

    @property
    def AUDIO_DIR(self) -> str:
        return os.path.join(self.STATIC_DIR, "audio")

    @property
    def is_gemini_configured(self) -> bool:
        return bool(self.GEMINI_API_KEY and self.GEMINI_API_KEY != "your_gemini_api_key_here")

    model_config = {
        "env_file": os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
