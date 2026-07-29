"""
Campaign Manager - Handles campaign lifecycle (start, pause, resume, cancel).
Coordinates between students, calls, and AI engine.
"""

import asyncio
from typing import Optional, Dict, List
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database.models import Campaign, Student, CampaignStatus, CallStatus
from app.logs.logger import get_logger

logger = get_logger(__name__)


class CampaignManager:
    """Manages campaign execution and state transitions."""
    
    def __init__(self):
        self.active_campaign: Optional[Campaign] = None
        self.is_running = False
        self.current_task: Optional[asyncio.Task] = None
        self._pause_event = asyncio.Event()
        self._stop_event = asyncio.Event()
    
    async def start_campaign(
        self, 
        campaign_id: int, 
        session: AsyncSession,
        call_callback=None
    ) -> bool:
        """
        Start a campaign.
        
        Args:
            campaign_id: ID of the campaign to start
            session: Database session
            call_callback: Async callback function to execute for each student call
            
        Returns:
            True if campaign started successfully
        """
        try:
            # Load campaign
            result = await session.execute(
                select(Campaign).where(Campaign.id == campaign_id)
            )
            campaign = result.scalar_one_or_none()
            
            if not campaign:
                logger.error(f"Campaign {campaign_id} not found")
                return False
            
            # Check if knowledge is ready
            if campaign.knowledge and campaign.knowledge.status != "ready":
                logger.error(f"Knowledge base not ready for campaign {campaign_id}")
                return False
            
            # Check if students are loaded
            if campaign.total_students == 0:
                logger.error(f"No students loaded for campaign {campaign_id}")
                return False
            
            # Update campaign status
            campaign.status = CampaignStatus.RUNNING
            campaign.started_at = datetime.utcnow()
            await session.commit()
            
            # Set as active campaign
            self.active_campaign = campaign
            self.is_running = True
            self._pause_event.clear()
            self._stop_event.clear()
            
            # Start campaign execution task
            self.current_task = asyncio.create_task(
                self._execute_campaign(session, call_callback)
            )
            
            logger.info(f"Campaign {campaign_id} started successfully")
            return True
        
        except Exception as e:
            logger.error(f"Failed to start campaign {campaign_id}: {e}")
            await session.rollback()
            return False
    
    async def pause_campaign(self, session: AsyncSession) -> bool:
        """
        Pause the currently running campaign.
        
        Args:
            session: Database session
            
        Returns:
            True if campaign paused successfully
        """
        if not self.is_running or not self.active_campaign:
            logger.warning("No active campaign to pause")
            return False
        
        try:
            self._pause_event.set()
            
            # Update campaign status
            self.active_campaign.status = CampaignStatus.PAUSED
            await session.execute(
                update(Campaign)
                .where(Campaign.id == self.active_campaign.id)
                .values(status=CampaignStatus.PAUSED)
            )
            await session.commit()
            
            logger.info(f"Campaign {self.active_campaign.id} paused")
            return True
        
        except Exception as e:
            logger.error(f"Failed to pause campaign: {e}")
            await session.rollback()
            return False
    
    async def resume_campaign(self, session: AsyncSession) -> bool:
        """
        Resume a paused campaign.
        
        Args:
            session: Database session
            
        Returns:
            True if campaign resumed successfully
        """
        if not self.active_campaign or self.active_campaign.status != CampaignStatus.PAUSED:
            logger.warning("No paused campaign to resume")
            return False
        
        try:
            self._pause_event.clear()
            
            # Update campaign status
            self.active_campaign.status = CampaignStatus.RUNNING
            await session.execute(
                update(Campaign)
                .where(Campaign.id == self.active_campaign.id)
                .values(status=CampaignStatus.RUNNING)
            )
            await session.commit()
            
            logger.info(f"Campaign {self.active_campaign.id} resumed")
            return True
        
        except Exception as e:
            logger.error(f"Failed to resume campaign: {e}")
            await session.rollback()
            return False
    
    async def cancel_campaign(self, session: AsyncSession) -> bool:
        """
        Cancel the currently running campaign.
        
        Args:
            session: Database session
            
        Returns:
            True if campaign cancelled successfully
        """
        if not self.is_running:
            logger.warning("No active campaign to cancel")
            return False
        
        try:
            self._stop_event.set()
            self.is_running = False
            
            if self.current_task:
                self.current_task.cancel()
                try:
                    await self.current_task
                except asyncio.CancelledError:
                    pass
            
            # Update campaign status
            if self.active_campaign:
                self.active_campaign.status = CampaignStatus.CANCELLED
                await session.execute(
                    update(Campaign)
                    .where(Campaign.id == self.active_campaign.id)
                    .values(status=CampaignStatus.CANCELLED)
                )
                await session.commit()
            
            logger.info("Campaign cancelled")
            return True
        
        except Exception as e:
            logger.error(f"Failed to cancel campaign: {e}")
            await session.rollback()
            return False
    
    async def _execute_campaign(
        self, 
        session: AsyncSession, 
        call_callback=None
    ):
        """
        Execute the campaign by calling students sequentially.
        
        Args:
            session: Database session
            call_callback: Async callback function for each student call
        """
        campaign = self.active_campaign
        if not campaign:
            return
        
        logger.info(f"Starting campaign execution for {campaign.campaign_name}")
        
        try:
            # Load students to call
            result = await session.execute(
                select(Student)
                .where(
                    Student.campaign_id == campaign.id,
                    Student.call_status == CallStatus.NOT_CALLED
                )
                .order_by(Student.id)
            )
            students = result.scalars().all()
            
            for student in students:
                # Check if campaign was stopped
                if self._stop_event.is_set():
                    logger.info("Campaign stopped by user")
                    break
                
                # Check if campaign is paused
                while self._pause_event.is_set():
                    await asyncio.sleep(1)
                    if self._stop_event.is_set():
                        break
                
                if self._stop_event.is_set():
                    break
                
                # Call the student
                logger.info(f"Calling student: {student.name} ({student.phone})")
                
                if call_callback:
                    await call_callback(student, campaign)
                
                # Small delay between calls
                await asyncio.sleep(2)
            
            # Mark campaign as completed
            if not self._stop_event.is_set():
                campaign.status = CampaignStatus.COMPLETED
                campaign.completed_at = datetime.utcnow()
                await session.execute(
                    update(Campaign)
                    .where(Campaign.id == campaign.id)
                    .values(
                        status=CampaignStatus.COMPLETED,
                        completed_at=datetime.utcnow()
                    )
                )
                await session.commit()
                logger.info(f"Campaign {campaign.id} completed successfully")
            
            self.is_running = False
        
        except Exception as e:
            logger.error(f"Error during campaign execution: {e}")
            campaign.status = CampaignStatus.CANCELLED
            await session.execute(
                update(Campaign)
                .where(Campaign.id == campaign.id)
                .values(status=CampaignStatus.CANCELLED)
            )
            await session.commit()
            self.is_running = False
    
    async def get_campaign_status(self, session: AsyncSession, campaign_id: int) -> Optional[Dict]:
        """
        Get current campaign status and statistics.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            Dictionary with campaign status and statistics
        """
        try:
            result = await session.execute(
                select(Campaign).where(Campaign.id == campaign_id)
            )
            campaign = result.scalar_one_or_none()
            
            if not campaign:
                return None
            
            # Get student statistics
            student_result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = student_result.scalars().all()
            
            stats = {
                "campaign_id": campaign.id,
                "campaign_name": campaign.campaign_name,
                "institute_name": campaign.institute_name,
                "status": campaign.status.value,
                "total_students": len(students),
                "completed_calls": len([s for s in students if s.call_status == CallStatus.COMPLETED]),
                "failed_calls": len([s for s in students if s.call_status == CallStatus.FAILED]),
                "in_call": len([s for s in students if s.call_status in [CallStatus.CALLING, CallStatus.CONNECTED, CallStatus.LISTENING, CallStatus.THINKING, CallStatus.SPEAKING]]),
                "pending_calls": len([s for s in students if s.call_status == CallStatus.NOT_CALLED]),
                "interested_students": len([s for s in students if s.interest_score and s.interest_score >= 70]),
                "follow_up_required": len([s for s in students if s.summary and s.summary.follow_up_required]),
                "average_duration": campaign.average_duration,
                "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
                "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None,
            }
            
            return stats
        
        except Exception as e:
            logger.error(f"Error getting campaign status: {e}")
            return None


# Global campaign manager instance
campaign_manager = CampaignManager()
