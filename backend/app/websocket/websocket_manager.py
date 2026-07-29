"""
WebSocket Manager - Handles real-time dashboard updates via WebSocket connections.
"""

import json
from typing import Dict, Set, Optional
from fastapi import WebSocket, WebSocketDisconnect
from app.logs.logger import get_logger

logger = get_logger(__name__)


class WebSocketManager:
    """Manages WebSocket connections for real-time updates."""
    
    def __init__(self):
        # campaign_id -> set of WebSocket connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        # connection_id -> campaign_id mapping
        self.connection_campaigns: Dict[int, int] = {}
        self._connection_id_counter = 0
    
    async def connect(self, websocket: WebSocket, campaign_id: int) -> int:
        """
        Connect a WebSocket to a campaign.
        
        Args:
            websocket: WebSocket connection
            campaign_id: Campaign ID to subscribe to
            
        Returns:
            Connection ID
        """
        await websocket.accept()
        
        # Generate connection ID
        self._connection_id_counter += 1
        connection_id = self._connection_id_counter
        
        # Add to campaign connections
        if campaign_id not in self.active_connections:
            self.active_connections[campaign_id] = set()
        
        self.active_connections[campaign_id].add(websocket)
        self.connection_campaigns[connection_id] = campaign_id
        
        logger.info(f"WebSocket {connection_id} connected to campaign {campaign_id}")
        
        # Send initial connection confirmation
        await self.send_personal_message(
            websocket,
            {
                "type": "connected",
                "connection_id": connection_id,
                "campaign_id": campaign_id
            }
        )
        
        return connection_id
    
    def disconnect(self, websocket: WebSocket, connection_id: int):
        """
        Disconnect a WebSocket connection.
        
        Args:
            websocket: WebSocket connection
            connection_id: Connection ID
        """
        # Get campaign ID
        campaign_id = self.connection_campaigns.get(connection_id)
        
        if campaign_id and campaign_id in self.active_connections:
            self.active_connections[campaign_id].discard(websocket)
            
            # Clean up empty campaign sets
            if not self.active_connections[campaign_id]:
                del self.active_connections[campaign_id]
        
        # Remove from mapping
        if connection_id in self.connection_campaigns:
            del self.connection_campaigns[connection_id]
        
        logger.info(f"WebSocket {connection_id} disconnected from campaign {campaign_id}")
    
    async def send_personal_message(self, websocket: WebSocket, message: dict):
        """
        Send a message to a specific WebSocket connection.
        
        Args:
            websocket: WebSocket connection
            message: Message dictionary
        """
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Failed to send personal message: {e}")
    
    async def broadcast_to_campaign(self, campaign_id: int, message: dict):
        """
        Broadcast a message to all connections subscribed to a campaign.
        
        Args:
            campaign_id: Campaign ID
            message: Message dictionary
        """
        if campaign_id not in self.active_connections:
            return
        
        disconnected = set()
        
        for connection in self.active_connections[campaign_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send message to connection: {e}")
                disconnected.add(connection)
        
        # Clean up disconnected connections
        for connection in disconnected:
            self.active_connections[campaign_id].discard(connection)
        
        logger.debug(f"Broadcasted message to {len(self.active_connections[campaign_id])} connections for campaign {campaign_id}")
    
    async def broadcast_to_all(self, message: dict):
        """
        Broadcast a message to all active connections.
        
        Args:
            message: Message dictionary
        """
        for campaign_id, connections in self.active_connections.items():
            await self.broadcast_to_campaign(campaign_id, message)
    
    async def send_campaign_update(self, campaign_id: int, update_type: str, data: dict):
        """
        Send a campaign update to all subscribers.
        
        Args:
            campaign_id: Campaign ID
            update_type: Type of update (e.g., "call_started", "call_completed", "student_updated")
            data: Update data
        """
        message = {
            "type": "campaign_update",
            "campaign_id": campaign_id,
            "update_type": update_type,
            "data": data,
            "timestamp": self._get_timestamp()
        }
        
        await self.broadcast_to_campaign(campaign_id, message)
    
    async def send_student_update(self, campaign_id: int, student_id: int, update_data: dict):
        """
        Send a student update to all campaign subscribers.
        
        Args:
            campaign_id: Campaign ID
            student_id: Student ID
            update_data: Student update data
        """
        message = {
            "type": "student_update",
            "campaign_id": campaign_id,
            "student_id": student_id,
            "data": update_data,
            "timestamp": self._get_timestamp()
        }
        
        await self.broadcast_to_campaign(campaign_id, message)
    
    async def send_call_status_update(
        self,
        campaign_id: int,
        student_id: int,
        status: str,
        additional_data: Optional[dict] = None
    ):
        """
        Send a call status update.
        
        Args:
            campaign_id: Campaign ID
            student_id: Student ID
            status: Call status
            additional_data: Additional data to include
        """
        message = {
            "type": "call_status_update",
            "campaign_id": campaign_id,
            "student_id": student_id,
            "status": status,
            "data": additional_data or {},
            "timestamp": self._get_timestamp()
        }
        
        await self.broadcast_to_campaign(campaign_id, message)
    
    async def send_campaign_statistics(self, campaign_id: int, statistics: dict):
        """
        Send updated campaign statistics.
        
        Args:
            campaign_id: Campaign ID
            statistics: Statistics dictionary
        """
        message = {
            "type": "campaign_statistics",
            "campaign_id": campaign_id,
            "statistics": statistics,
            "timestamp": self._get_timestamp()
        }
        
        await self.broadcast_to_campaign(campaign_id, message)
    
    def get_connection_count(self, campaign_id: Optional[int] = None) -> int:
        """
        Get the number of active connections.
        
        Args:
            campaign_id: Optional campaign ID to filter by
            
        Returns:
            Number of active connections
        """
        if campaign_id:
            return len(self.active_connections.get(campaign_id, set()))
        return sum(len(conns) for conns in self.active_connections.values())
    
    def _get_timestamp(self) -> str:
        """Get current timestamp in ISO format."""
        from datetime import datetime
        return datetime.utcnow().isoformat()


# Global WebSocket manager instance
websocket_manager = WebSocketManager()
