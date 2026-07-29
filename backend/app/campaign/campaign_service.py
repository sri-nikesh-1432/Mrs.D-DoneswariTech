"""
Campaign Service - Handles campaign CRUD operations and business logic.
"""

from typing import Optional, List, Dict
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from sqlalchemy.orm import selectinload

from app.database.models import Campaign, Student, Knowledge, CampaignStatus, KnowledgeStatus
from app.logs.logger import get_logger

logger = get_logger(__name__)


class CampaignService:
    """Service for campaign operations."""
    
    async def create_campaign(
        self,
        session: AsyncSession,
        campaign_name: str,
        institute_name: str,
        language: str = "en",
        voice: str = "en-US-AriaNeural"
    ) -> Campaign:
        """
        Create a new campaign.
        
        Args:
            session: Database session
            campaign_name: Name of the campaign
            institute_name: Name of the institute
            language: Preferred language
            voice: Preferred voice
            
        Returns:
            Created Campaign object
        """
        try:
            campaign = Campaign(
                campaign_name=campaign_name,
                institute_name=institute_name,
                language=language,
                voice=voice,
                status=CampaignStatus.PENDING
            )
            
            session.add(campaign)
            await session.commit()
            await session.refresh(campaign)
            
            logger.info(f"Created campaign: {campaign_name} (ID: {campaign.id})")
            return campaign
        
        except Exception as e:
            logger.error(f"Failed to create campaign: {e}")
            await session.rollback()
            raise
    
    async def get_campaign(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> Optional[Campaign]:
        """
        Get a campaign by ID with related data.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            Campaign object or None
        """
        try:
            result = await session.execute(
                select(Campaign)
                .options(
                    selectinload(Campaign.students),
                    selectinload(Campaign.knowledge)
                )
                .where(Campaign.id == campaign_id)
            )
            return result.scalar_one_or_none()
        
        except Exception as e:
            logger.error(f"Failed to get campaign {campaign_id}: {e}")
            return None
    
    async def list_campaigns(
        self,
        session: AsyncSession,
        limit: int = 100,
        offset: int = 0
    ) -> List[Campaign]:
        """
        List all campaigns.
        
        Args:
            session: Database session
            limit: Maximum number of results
            offset: Offset for pagination
            
        Returns:
            List of Campaign objects
        """
        try:
            result = await session.execute(
                select(Campaign)
                .order_by(Campaign.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
            return list(result.scalars().all())
        
        except Exception as e:
            logger.error(f"Failed to list campaigns: {e}")
            return []
    
    async def update_campaign(
        self,
        session: AsyncSession,
        campaign_id: int,
        **kwargs
    ) -> Optional[Campaign]:
        """
        Update campaign details.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            **kwargs: Fields to update
            
        Returns:
            Updated Campaign object or None
        """
        try:
            await session.execute(
                update(Campaign)
                .where(Campaign.id == campaign_id)
                .values(**kwargs)
            )
            await session.commit()
            
            return await self.get_campaign(session, campaign_id)
        
        except Exception as e:
            logger.error(f"Failed to update campaign {campaign_id}: {e}")
            await session.rollback()
            return None
    
    async def delete_campaign(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> bool:
        """
        Delete a campaign.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            True if deleted successfully
        """
        try:
            await session.execute(
                delete(Campaign).where(Campaign.id == campaign_id)
            )
            await session.commit()
            
            logger.info(f"Deleted campaign {campaign_id}")
            return True
        
        except Exception as e:
            logger.error(f"Failed to delete campaign {campaign_id}: {e}")
            await session.rollback()
            return False
    
    async def update_campaign_statistics(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> bool:
        """
        Update campaign statistics based on student data.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            True if updated successfully
        """
        try:
            # Get all students for the campaign
            result = await session.execute(
                select(Student).where(Student.campaign_id == campaign_id)
            )
            students = result.scalars().all()
            
            # Calculate statistics
            total_students = len(students)
            completed_calls = len([s for s in students if s.call_status.value == "completed"])
            failed_calls = len([s for s in students if s.call_status.value == "failed"])
            interested_students = len([s for s in students if s.interest_score and s.interest_score >= 70])
            follow_up_required = len([s for s in students if s.summary and s.summary.follow_up_required])
            
            # Calculate average duration
            completed_students = [s for s in students if s.call_duration > 0]
            avg_duration = sum(s.call_duration for s in completed_students) / len(completed_students) if completed_students else 0
            
            # Update campaign
            await session.execute(
                update(Campaign)
                .where(Campaign.id == campaign_id)
                .values(
                    total_students=total_students,
                    completed_calls=completed_calls,
                    failed_calls=failed_calls,
                    interested_students=interested_students,
                    follow_up_required=follow_up_required,
                    average_duration=avg_duration
                )
            )
            await session.commit()
            
            logger.info(f"Updated statistics for campaign {campaign_id}")
            return True
        
        except Exception as e:
            logger.error(f"Failed to update campaign statistics: {e}")
            await session.rollback()
            return False
    
    async def can_start_campaign(
        self,
        session: AsyncSession,
        campaign_id: int
    ) -> tuple[bool, str]:
        """
        Check if a campaign can be started.
        
        Args:
            session: Database session
            campaign_id: Campaign ID
            
        Returns:
            Tuple of (can_start, reason)
        """
        try:
            campaign = await self.get_campaign(session, campaign_id)
            
            if not campaign:
                return False, "Campaign not found"
            
            # Check if knowledge is ready
            if not campaign.knowledge or campaign.knowledge.status != KnowledgeStatus.READY:
                return False, "Knowledge base is not ready"
            
            # Check if students are loaded
            if campaign.total_students == 0:
                return False, "No students loaded"
            
            # Check if campaign is already running
            if campaign.status == CampaignStatus.RUNNING:
                return False, "Campaign is already running"
            
            return True, "Campaign can be started"
        
        except Exception as e:
            logger.error(f"Error checking if campaign can start: {e}")
            return False, f"Error: {str(e)}"
