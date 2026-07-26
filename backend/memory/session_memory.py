"""
Lightweight in-memory conversation memory.
No RAG, no vector DB, no LangChain — just a rolling window of messages per session.
"""

import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any
from utils.config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

# session_id → { "history": [...], "last_active": datetime }
_sessions: Dict[str, Dict[str, Any]] = {}


def create_session() -> str:
    """Create a new session and return its ID."""
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "history": [],
        "last_active": datetime.utcnow(),
    }
    logger.info("Session created: %s", session_id)
    return session_id


def get_or_create_session(session_id: str) -> str:
    """Return the session_id if it exists, otherwise create it."""
    if session_id not in _sessions:
        _sessions[session_id] = {
            "history": [],
            "last_active": datetime.utcnow(),
        }
        logger.info("Session auto-created: %s", session_id)
    else:
        _sessions[session_id]["last_active"] = datetime.utcnow()
    return session_id


def add_turn(session_id: str, user_message: str, assistant_message: str) -> None:
    """Append a user/assistant turn to the session history."""
    get_or_create_session(session_id)
    history = _sessions[session_id]["history"]

    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": assistant_message})

    # Keep only the last MAX_HISTORY_TURNS * 2 messages (each turn = 2 messages)
    max_msgs = settings.MAX_HISTORY_TURNS * 2
    if len(history) > max_msgs:
        _sessions[session_id]["history"] = history[-max_msgs:]


def get_history(session_id: str) -> List[Dict[str, str]]:
    """Return the conversation history for a session (list of role/content dicts)."""
    if session_id not in _sessions:
        return []
    return _sessions[session_id]["history"]


def reset_session(session_id: str) -> None:
    """Clear the conversation history for a session."""
    if session_id in _sessions:
        _sessions[session_id]["history"] = []
        _sessions[session_id]["last_active"] = datetime.utcnow()
        logger.info("Session reset: %s", session_id)


def delete_session(session_id: str) -> None:
    """Fully remove a session."""
    _sessions.pop(session_id, None)
    logger.info("Session deleted: %s", session_id)


def purge_expired_sessions() -> int:
    """Remove sessions inactive beyond SESSION_TIMEOUT_MINUTES. Returns count removed."""
    cutoff = datetime.utcnow() - timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)
    expired = [sid for sid, data in _sessions.items() if data["last_active"] < cutoff]
    for sid in expired:
        del _sessions[sid]
    if expired:
        logger.info("Purged %d expired sessions", len(expired))
    return len(expired)


def get_session_info(session_id: str) -> Dict[str, Any]:
    """Return metadata about a session."""
    if session_id not in _sessions:
        return {"exists": False}
    data = _sessions[session_id]
    return {
        "exists": True,
        "session_id": session_id,
        "turn_count": len(data["history"]) // 2,
        "last_active": data["last_active"].isoformat(),
    }
