"""
WebSocket Handler — Provides live updates to the campaign dashboard.
"""

import json
import asyncio
from typing import Set, Any
from fastapi import WebSocket, WebSocketDisconnect, APIRouter
from app.utils.logger import get_logger
from app.campaign.manager import campaign_manager

logger = get_logger(__name__)
router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.add(websocket)
        logger.info("WebSocket client connected (%d total)", len(self._connections))

    async def disconnect(self, websocket: WebSocket):
        self._connections.discard(websocket)
        logger.info("WebSocket client disconnected (%d remaining)", len(self._connections))

    async def broadcast(self, event_type: str, data: Any):
        message = json.dumps({"type": event_type, "data": data}, default=str)
        dead = set()
        for ws in self._connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections.discard(ws)


manager = ConnectionManager()


@router.websocket("/ws/live-dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        async def broadcast_callback(event_type: str, data: Any):
            await manager.broadcast(event_type, data)
        campaign_manager.register_callback(broadcast_callback)
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "data": {}}))
            except asyncio.TimeoutError:
                try:
                    await websocket.send_text(json.dumps({"type": "ping", "data": {}}))
                except Exception:
                    break
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error("WebSocket error: %s", e)
    finally:
        await manager.disconnect(websocket)
