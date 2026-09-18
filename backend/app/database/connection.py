"""
Database connection management for Doneswari AI Telecaller Platform.
"""

from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from app.config.settings import settings

# Ensure deterministic absolute SQLite database path
db_url = settings.DATABASE_URL
if db_url.startswith("sqlite+aiosqlite:///./"):
    rel = db_url.replace("sqlite+aiosqlite:///./", "")
    abs_db = (settings.BASE_DIR / rel).resolve()
    db_url = f"sqlite+aiosqlite:///{abs_db}"

# Create async engine
engine = create_async_engine(
    db_url,
    echo=settings.DEBUG,
    future=True
)

# Create async session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Base class for models
Base = declarative_base()


async def get_database() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency for getting async database sessions.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def _migrate_schema(sync_conn):
    """
    Lightweight schema migrations for existing SQLite databases.
    SQLAlchemy create_all() only creates missing tables, not newly added columns.
    """
    from sqlalchemy import inspect

    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()

    # Institutes table migrations
    if "institutes" in tables:
        cols = {c["name"] for c in inspector.get_columns("institutes")}
        new_cols = {
            "workspace_id": "INTEGER",
            "user_id": "INTEGER",
            "agent_name": "VARCHAR(255) DEFAULT 'Aadhya'",
            "calling_purpose": "VARCHAR(255) DEFAULT 'Admissions and Student Enquiry'",
            "description": "TEXT",
            "voice_speed": "FLOAT DEFAULT 1.0",
            "instructions": "TEXT",
            "status": "VARCHAR(50) DEFAULT 'ready'",
            "total_students": "INTEGER DEFAULT 0",
            "failed_calls": "INTEGER DEFAULT 0",
            "interested_count": "INTEGER DEFAULT 0",
            "not_interested_count": "INTEGER DEFAULT 0",
            "follow_up_count": "INTEGER DEFAULT 0",
            "callback_count": "INTEGER DEFAULT 0",
        }
        for col, col_type in new_cols.items():
            if col not in cols:
                try:
                    sync_conn.exec_driver_sql(f"ALTER TABLE institutes ADD COLUMN {col} {col_type}")
                    print(f"Migration: added institutes.{col}")
                except Exception as e:
                    pass

    # Call history table migrations
    if "call_history" in tables:
        cols = {c["name"] for c in inspector.get_columns("call_history")}
        new_cols = {
            "student_id": "INTEGER",
            "detected_language": "VARCHAR(50)",
            "interest_level": "VARCHAR(50) DEFAULT 'Unclear'",
            "outcome": "VARCHAR(255)",
            "callback_requested": "BOOLEAN DEFAULT 0",
            "avg_retrieval_time_ms": "FLOAT",
            "avg_stt_time_ms": "FLOAT",
            "avg_llm_response_time_ms": "FLOAT",
            "avg_tts_time_ms": "FLOAT",
            "total_latency_ms": "FLOAT",
            "objections": "JSON",
        }
        for col, col_type in new_cols.items():
            if col not in cols:
                try:
                    sync_conn.exec_driver_sql(f"ALTER TABLE call_history ADD COLUMN {col} {col_type}")
                    print(f"Migration: added call_history.{col}")
                except Exception as e:
                    pass


async def init_database():
    """
    Initialize database tables.
    """
    from app.database import models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_schema)


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager for database sessions.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
