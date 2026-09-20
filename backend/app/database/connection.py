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
        for col, col_type in {
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
            # Real telephony metadata (spec §32)
            "provider": "VARCHAR(50)",
            "provider_call_id": "VARCHAR(120)",
            "direction": "VARCHAR(20)",
        }.items():
            if col not in cols:
                try:
                    sync_conn.exec_driver_sql(f"ALTER TABLE call_history ADD COLUMN {col} {col_type}")
                    print(f"Migration: added call_history.{col}")
                except Exception:
                    pass

    # Students table migrations (spec §35 retry logic)
    if "students" in tables:
        cols = {c["name"] for c in inspector.get_columns("students")}
        if "call_attempt_count" not in cols:
            try:
                sync_conn.exec_driver_sql("ALTER TABLE students ADD COLUMN call_attempt_count INTEGER DEFAULT 0")
                print("Migration: added students.call_attempt_count")
            except Exception:
                pass

    # Knowledge table migrations (spec §48 document versioning + §4 real
    # extraction metadata columns)
    if "knowledge" in tables:
        cols = {c["name"] for c in inspector.get_columns("knowledge")}
        for col, col_type in {
            "document_version": "INTEGER DEFAULT 1",
            "is_active": "BOOLEAN DEFAULT 1",
            "ingestion_stage": "VARCHAR(50)",
            "ingestion_error": "TEXT",
            "page_count": "INTEGER",
            "extracted_character_count": "INTEGER",
            "extracted_word_count": "INTEGER",
            "extraction_method": "VARCHAR(50)",
            "extraction_status": "VARCHAR(30)",
            "extraction_previews": "JSON",
        }.items():
            if col not in cols:
                try:
                    sync_conn.exec_driver_sql(f"ALTER TABLE knowledge ADD COLUMN {col} {col_type}")
                    print(f"Migration: added knowledge.{col}")
                except Exception:
                    pass

    # Knowledge chunks table migrations (spec §7): provenance metadata added
    # after the table was first created.
    if "knowledge_chunks" in tables:
        cols = {c["name"] for c in inspector.get_columns("knowledge_chunks")}
        for col, col_type in {
            "workspace_id": "INTEGER",
            "document_version_id": "INTEGER",
            "character_count": "INTEGER",
            "embedding_model": "VARCHAR(100)",
        }.items():
            if col not in cols:
                try:
                    sync_conn.exec_driver_sql(f"ALTER TABLE knowledge_chunks ADD COLUMN {col} {col_type}")
                    print(f"Migration: added knowledge_chunks.{col}")
                except Exception:
                    pass

    # Legacy SQLite schema: institutes.phone_number was created NOT NULL.
    # The model now allows NULL (spec §3 §45) — rebuild the table to drop the
    # constraint (SQLite cannot ALTER a constraint in place).
    if "institutes" in tables:
        pn_nullable = next(
            (c.get("nullable") for c in inspector.get_columns("institutes") if c["name"] == "phone_number"),
            None,
        )
        if pn_nullable is False:
            try:
                sync_conn.exec_driver_sql(
                    """
                    CREATE TABLE institutes_new (
                        id INTEGER PRIMARY KEY,
                        institute_id VARCHAR(64) NOT NULL,
                        workspace_id INTEGER,
                        user_id INTEGER,
                        name VARCHAR(255) NOT NULL,
                        agent_name VARCHAR(255) DEFAULT 'Aadhya',
                        phone_number VARCHAR(30),
                        calling_purpose VARCHAR(255) DEFAULT 'Admissions and Student Enquiry',
                        description TEXT,
                        language VARCHAR(50) DEFAULT 'en',
                        voice VARCHAR(100) DEFAULT 'en-IN-NeerjaNeural',
                        voice_speed FLOAT DEFAULT 1.0,
                        greeting_message TEXT,
                        instructions TEXT,
                        status VARCHAR(50) DEFAULT 'ready',
                        total_students INTEGER DEFAULT 0,
                        total_calls INTEGER DEFAULT 0,
                        completed_calls INTEGER DEFAULT 0,
                        missed_calls INTEGER DEFAULT 0,
                        failed_calls INTEGER DEFAULT 0,
                        interested_count INTEGER DEFAULT 0,
                        not_interested_count INTEGER DEFAULT 0,
                        follow_up_count INTEGER DEFAULT 0,
                        callback_count INTEGER DEFAULT 0,
                        total_duration_seconds FLOAT DEFAULT 0.0,
                        created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
                        updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP)
                    )
                    """
                )
                sync_conn.exec_driver_sql(
                    """
                    INSERT INTO institutes_new
                    SELECT id, institute_id, workspace_id, user_id, name, agent_name,
                           phone_number, calling_purpose, description, language, voice,
                           voice_speed, greeting_message, instructions, status,
                           total_students, total_calls, completed_calls, missed_calls,
                           failed_calls, interested_count, not_interested_count,
                           follow_up_count, callback_count, total_duration_seconds,
                           created_at, updated_at
                    FROM institutes
                    """
                )
                sync_conn.exec_driver_sql("DROP TABLE institutes")
                sync_conn.exec_driver_sql("ALTER TABLE institutes_new RENAME TO institutes")
                print("Migration: institutes.phone_number is now nullable")
            except Exception as e:
                print(f"Migration: institutes phone_number rebuild failed: {e}")


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
