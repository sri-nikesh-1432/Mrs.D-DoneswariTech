"""
Application settings for Mrs. D AI Admission Campaign Platform.
"""

import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application configuration settings."""
    
    # Application
    APP_NAME: str = "Mrs. D - AI Admission Campaign Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = Field(default=False, env="DEBUG")
    
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
    GROQ_MODEL: str = Field(default="llama-3.3-70b-versatile", env="GROQ_MODEL")
    
    # RAG / Embeddings
    EMBEDDING_MODEL: str = Field(default="all-MiniLM-L6-v2", env="EMBEDDING_MODEL")
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
    BASE_DIR: Path = Field(default=Path(__file__).parent.parent.parent)
    UPLOADS_DIR: Path = Field(default=Path("uploads"))
    KNOWLEDGE_DIR: Path = Field(default=Path("uploads/knowledge"))
    STUDENTS_DIR: Path = Field(default=Path("uploads/students"))
    VECTOR_DB_DIR: Path = Field(default=Path("uploads/vector_db"))
    REPORTS_DIR: Path = Field(default=Path("generated_reports"))
    LOGS_DIR: Path = Field(default=Path("logs"))
    STATIC_DIR: Path = Field(default=Path("static"))
    AUDIO_DIR: Path = Field(default=Path("static/audio"))
    
    # Voice
    TTS_VOICE: str = Field(default="en-US-AriaNeural", env="TTS_VOICE")
    TTS_RATE: str = Field(default="+0%", env="TTS_RATE")
    TTS_VOLUME: str = Field(default="+0%", env="TTS_VOLUME")
    MAX_CONCURRENT_CALLS: int = Field(default=1, env="MAX_CONCURRENT_CALLS")
    CALL_RETRY_ATTEMPTS: int = Field(default=3, env="CALL_RETRY_ATTEMPTS")
    CALL_TIMEOUT_SECONDS: int = Field(default=300, env="CALL_TIMEOUT_SECONDS")
    
    # Security
    SECRET_KEY: str = Field(default="your-secret-key-change-in-production", env="SECRET_KEY")
    ALLOWED_ORIGINS: list = Field(default=["*"], env="ALLOWED_ORIGINS")
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    
    @property
    def is_groq_configured(self) -> bool:
        """Check if Groq API key is configured."""
        return bool(self.GROQ_API_KEY) and self.GROQ_API_KEY != "your_groq_api_key_here"

    class Config:
        env_file = ".env"
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
            full_path = self.BASE_DIR / directory
            full_path.mkdir(parents=True, exist_ok=True)


settings = Settings()
