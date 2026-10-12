from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # LLM
    llm_provider: str = "groq"
    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"
    gemini_api_key: str = ""

    # ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""
    elevenlabs_voice_id: str = "EXAVITQu4vr4xnSDxMaL"  # default Sarah voice

    # Embeddings
    embedding_model: str = "all-MiniLM-L6-v2"
    chunk_size: int = 800
    chunk_overlap: int = 150
    top_k_results: int = 5

    # Database
    database_url: str = "sqlite+aiosqlite:///./doneswari.db"

    # File limits
    max_upload_size: int = 20 * 1024 * 1024  # 20MB

    # App
    app_env: str = "development"
    cors_origins: str = "http://localhost:5176,http://localhost:5173"

    # Data directories
    data_dir: Path = Path("data")
    uploads_dir: Path = Path("data/uploads")
    indexes_dir: Path = Path("data/indexes")
    agents_dir: Path = Path("data/agents")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

# Ensure directories exist
for d in [settings.data_dir, settings.uploads_dir, settings.indexes_dir, settings.agents_dir]:
    d.mkdir(parents=True, exist_ok=True)
