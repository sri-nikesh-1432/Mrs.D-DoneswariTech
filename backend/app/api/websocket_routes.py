"""
WebSocket API Routes - Handle real-time dashboard updates.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database
from app.websocket.websocket_manager import websocket_manager
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/ws", tags=["WebSocket"])


@router.websocket("/campaign/{campaign_id}")
async def websocket_campaign_endpoint(
    websocket: WebSocket,
    campaign_id: int
):
    """
    WebSocket endpoint for real-time campaign updates.
    
    Connect to this endpoint to receive live updates for a specific campaign.
    """
    try:
        # Accept connection
        connection_id = await websocket_manager.connect(websocket, campaign_id)
        
        try:
            # Keep connection alive and handle incoming messages
            while True:
                # Wait for client messages (if any)
                data = await websocket.receive_text()
                
                # Handle client messages if needed
                # For now, we just log them
                logger.debug(f"Received message from connection {connection_id}: {data}")
        
        except WebSocketDisconnect:
            websocket_manager.disconnect(websocket, connection_id)
            logger.info(f"WebSocket {connection_id} disconnected")
    
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if 'connection_id' in locals():
            websocket_manager.disconnect(websocket, connection_id)
