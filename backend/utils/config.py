"""
Application Configuration
Loads all settings from .env using pydantic-settings.
All paths are resolved relative to the backend directory automatically.
"""

import os
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── Groq API ──────────────────────────────────────────────────
    GROQ_API_KEY: str = Field(default="", description="Groq API key")
    GROQ_STT_MODEL: str = Field(default="whisper-large-v3-turbo")
    GROQ_LLM_MODEL: str = Field(default="llama-3.3-70b-versatile")

    # ── Text-to-Speech ────────────────────────────────────────────
    TTS_VOICE: str = Field(default="te-IN-ShrutiNeural")
    TTS_RATE: str = Field(default="+25%")

    # Multilingual voice map: lang_code → Edge-TTS voice name
    TTS_VOICE_MAP: dict = {
        "en": "en-IN-NeerjaNeural",
        "te": "te-IN-ShrutiNeural",
        "hi": "hi-IN-SwaraNeural",
        "ta": "ta-IN-PallaviNeural",
        "kn": "kn-IN-SapnaNeural",
        "ml": "ml-IN-SobhanaNeural",
    }

    # ── Server ────────────────────────────────────────────────────
    HOST: str = Field(default="localhost")
    PORT: int = Field(default=8000)

    # ── Frontend ──────────────────────────────────────────────────
    FRONTEND_PORT: int = Field(default=5175)

    # ── Session Management ────────────────────────────────────────
    SESSION_TIMEOUT_MINUTES: int = Field(default=30)
    MAX_HISTORY_TURNS: int = Field(default=20)

    # ── Audio Cleanup ─────────────────────────────────────────────
    AUDIO_CLEANUP_MINUTES: int = Field(default=10)

    # ── Logging ───────────────────────────────────────────────────
    LOG_LEVEL: str = Field(default="INFO")

    # ── Derived Paths (not from .env) ─────────────────────────────
    @property
    def BASE_DIR(self) -> str:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    @property
    def PROMPTS_DIR(self) -> str:
        return os.path.join(self.BASE_DIR, "prompts")

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
    def is_groq_configured(self) -> bool:
        return bool(
            self.GROQ_API_KEY
            and self.GROQ_API_KEY != "your_groq_api_key_here"
        )

    model_config = {
        "env_file": os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
