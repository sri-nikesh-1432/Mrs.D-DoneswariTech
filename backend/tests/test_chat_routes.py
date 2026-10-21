"""
Tests for the /api/chat endpoints (spec: REST text chat, multi-turn session memory,
grounded RAG responses, and Roman Telugu support).
"""

import pytest
from starlette.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_and_ready_endpoints():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json().get("status") == "healthy"

    res = client.get("/ready")
    assert res.status_code == 200
    assert res.json().get("status") == "ready"


def test_chat_history_empty_session():
    res = client.get("/api/chat/history/test-session-nonexistent-999")
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == "test-session-nonexistent-999"
    assert data["history"] == []


def test_chat_clear_session():
    res = client.post("/api/chat/clear", json={"session_id": "test-session-clear-123"})
    assert res.status_code == 200
    assert res.json()["status"] == "cleared"


def test_chat_endpoint_validation():
    # Missing required message should return 422
    res = client.post("/api/chat", json={})
    assert res.status_code == 422


def test_chat_message_execution():
    session_id = "test-unit-chat-session-001"
    res = client.post(
        "/api/chat",
        json={
            "agent_id": 1,
            "message": "Hello, what courses are offered?",
            "session_id": session_id,
            "language": "English",
            "return_audio": False,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "response" in data
    assert len(data["response"]) > 0
    assert data["session_id"] == session_id

    # Check history contains both the user turn and the assistant turn
    hist_res = client.get(f"/api/chat/history/{session_id}")
    assert hist_res.status_code == 200
    hist = hist_res.json()["history"]
    assert len(hist) >= 2
    assert hist[0]["role"] == "user"
    assert hist[0]["content"] == "Hello, what courses are offered?"
    assert hist[1]["role"] == "assistant"


def test_chat_clear_after_conversation():
    session_id = "test-unit-chat-session-002"
    # Send message
    client.post(
        "/api/chat",
        json={
            "agent_id": 1,
            "message": "What is the fee for MPC?",
            "session_id": session_id,
            "language": "English",
            "return_audio": False,
        },
    )
    # Verify history has entries
    hist_res = client.get(f"/api/chat/history/{session_id}")
    assert len(hist_res.json()["history"]) >= 2

    # Clear history
    client.post("/api/chat/clear", json={"session_id": session_id})

    # Verify history is now empty
    hist_res2 = client.get(f"/api/chat/history/{session_id}")
    assert hist_res2.json()["history"] == []
