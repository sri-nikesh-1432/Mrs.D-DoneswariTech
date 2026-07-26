"""
/history and /reset-session routes
Conversation history retrieval and session management.
"""

import json
import os
from fastapi import APIRouter, HTTPException, Query
from memory.session_memory import (
    get_history, reset_session, get_session_info,
    create_session, purge_expired_sessions
)
from utils.config import settings
from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/history/{session_id}")
async def get_conversation_history(session_id: str):
    """Return the full conversation history for a session."""
    info = get_session_info(session_id)
    if not info["exists"]:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    history = get_history(session_id)
    # Format into readable turns
    turns = []
    for i in range(0, len(history), 2):
        turn = {"turn": i // 2 + 1, "user": history[i]["content"]}
        if i + 1 < len(history):
            turn["assistant"] = history[i + 1]["content"]
        turns.append(turn)

    return {
        "session_id": session_id,
        "turn_count": info["turn_count"],
        "last_active": info["last_active"],
        "history": turns,
    }


@router.post("/reset-session/{session_id}")
async def reset_session_route(session_id: str):
    """Clear conversation history for a session (keeps session alive)."""
    info = get_session_info(session_id)
    if not info["exists"]:
        # Auto-create if not found
        from memory.session_memory import get_or_create_session
        get_or_create_session(session_id)

    reset_session(session_id)
    logger.info("Session reset via API: %s", session_id)
    return {"message": "Session reset successfully", "session_id": session_id}


@router.post("/new-session")
async def new_session():
    """Create a brand new session and return its ID."""
    session_id = create_session()
    return {"session_id": session_id}


@router.get("/session-info/{session_id}")
async def session_info(session_id: str):
    """Get metadata about a session."""
    info = get_session_info(session_id)
    if not info["exists"]:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    return info


@router.get("/conversation-logs")
async def get_conversation_logs(limit: int = Query(default=50, le=500)):
    """
    Return recent conversation logs from the JSONL log file.
    Useful for admin/debugging purposes.
    """
    log_path = os.path.join(settings.LOGS_DIR, "conversations.jsonl")
    if not os.path.exists(log_path):
        return {"logs": [], "total": 0}

    logs = []
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    logs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    # Return most recent `limit` entries
    recent = logs[-limit:]
    recent.reverse()
    return {"logs": recent, "total": len(logs)}
