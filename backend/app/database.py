"""
Database setup and connection management.
Supports SQLite (dev) and PostgreSQL (production) via async SQLAlchemy.
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import create_engine, event
from app.config import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    pass


# ── Engine & Session ─────────────────────────────────────────────────────────

_engine = None
_async_session_maker = None


def get_database_url() -> str:
    """Get the database URL, ensuring aiosqlite driver for SQLite."""
    url = settings.DATABASE_URL
    if url.startswith("sqlite:///") and "aiosqlite" not in url:
        url = url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    return url


def get_engine():
    global _engine
    if _engine is None:
        db_url = get_database_url()
        logger.info("Creating database engine: %s", db_url)
        _engine = create_async_engine(
            db_url,
            echo=False,
            pool_pre_ping=True,
        )
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    global _async_session_maker
    if _async_session_maker is None:
        _async_session_maker = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _async_session_maker


async def init_db():
    """Create all tables."""
    async with get_engine().begin() as conn:
        from app.database.models import Campaign, Student, Knowledge, CallLog, Report  # noqa
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created successfully")


async def get_session() -> AsyncSession:
    """Get an async database session."""
    maker = get_session_maker()
    async with maker() as session:
        yield session


async def close_db():
    """Dispose of the database engine."""
    global _engine
    if _engine:
        await _engine.dispose()
        _engine = None
        logger.info("Database engine disposed")
