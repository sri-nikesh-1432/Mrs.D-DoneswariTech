"""
Database connection management for Mrs. D AI Admission Campaign Platform.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from app.config.settings import settings

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
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
    Lightweight schema migrations for existing databases.
    SQLAlchemy's create_all() only creates missing tables; it never adds
    columns to tables that already exist, so we ALTER TABLE explicitly.

    NOTE: this must be a SYNC function — it is passed to conn.run_sync()
    which calls it with a synchronous connection.
    """
    from sqlalchemy import inspect

    inspector = inspect(sync_conn)
    tables = inspector.get_table_names()

    if "call_history" in tables:
        cols = {c["name"] for c in inspector.get_columns("call_history")}
        if "detected_language" not in cols:
            sync_conn.exec_driver_sql(
                "ALTER TABLE call_history ADD COLUMN detected_language VARCHAR(50)"
            )
            print("Migration: added call_history.detected_language")


async def init_database():
    """
    Initialize database tables.
    """
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
