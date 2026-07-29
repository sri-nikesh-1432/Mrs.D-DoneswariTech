"""
Student API Routes - Handle student list upload and student operations.
"""

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.database.connection import get_database
from app.database.models import Campaign, Student
from app.uploads.student_service import StudentService
from app.campaign.campaign_service import CampaignService
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/students", tags=["Students"])


@router.post("/upload")
async def upload_students(
    campaign_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_database)
):
    """
    Upload student list from Excel or CSV.
    
    Expected columns:
    - Student Name (required)
    - Phone Number (required)
    - Interested Course (optional)
    - Email (optional)
    - City (optional)
    """
    try:
        # Get campaign
        campaign_service = CampaignService()
        campaign = await campaign_service.get_campaign(session, campaign_id)
        
        if not campaign:
            raise HTTPException(status_code=404, detail="Campaign not found")
        
        # Read file content
        file_content = await file.read()
        
        # Validate file
        student_service = StudentService()
        is_valid, error_message = await student_service.validate_file(file_content, file.filename)
        
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_message)
        
        # Save file
        file_path = await student_service.save_file(file_content, file.filename)
        
        # Parse students
        students, errors = await student_service.parse_students(file_path)
        
        if errors:
            return {
                "message": "File parsed with errors",
                "students": len(students),
                "errors": errors
            }
        
        # Remove duplicates
        unique_students, duplicates_removed = await student_service.remove_duplicates(students)
        
        # Store students in database
        imported_count = 0
        for student_data in unique_students:
            # Check if student already exists
            existing = await session.execute(
                select(Student).where(
                    Student.campaign_id == campaign_id,
                    Student.phone == student_data['phone']
                )
            )
            if not existing.scalar_one_or_none():
                student = Student(
                    campaign_id=campaign_id,
                    name=student_data['name'],
                    phone=student_data['phone'],
                    email=student_data.get('email'),
                    preferred_course=student_data.get('preferred_course'),
                    city=student_data.get('city'),
                    state=student_data.get('state'),
                    notes=student_data.get('notes')
                )
                session.add(student)
                imported_count += 1
        
        await session.commit()
        
        # Update campaign statistics
        await campaign_service.update_campaign_statistics(session, campaign_id)
        
        return {
            "message": "Students imported successfully",
            "total_students": len(unique_students),
            "imported": imported_count,
            "duplicates_removed": duplicates_removed,
            "campaign_id": campaign_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading students: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/campaign/{campaign_id}")
async def get_campaign_students(
    campaign_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get all students for a campaign."""
    try:
        result = await session.execute(
            select(Student).where(Student.campaign_id == campaign_id)
        )
        students = result.scalars().all()
        
        return {
            "campaign_id": campaign_id,
            "students": [
                {
                    "id": s.id,
                    "name": s.name,
                    "phone": s.phone,
                    "email": s.email,
                    "preferred_course": s.preferred_course,
                    "city": s.city,
                    "call_status": s.call_status.value,
                    "call_duration": s.call_duration,
                    "sentiment": s.sentiment.value if s.sentiment else None,
                    "interest_score": s.interest_score,
                    "called_at": s.called_at.isoformat() if s.called_at else None
                }
                for s in students
            ]
        }
    
    except Exception as e:
        logger.error(f"Error getting campaign students: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{student_id}")
async def get_student(
    student_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Get a specific student."""
    try:
        result = await session.execute(
            select(Student).where(Student.id == student_id)
        )
        student = result.scalar_one_or_none()
        
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        return {
            "id": student.id,
            "campaign_id": student.campaign_id,
            "name": student.name,
            "phone": student.phone,
            "email": student.email,
            "preferred_course": student.preferred_course,
            "city": student.city,
            "state": student.state,
            "notes": student.notes,
            "call_status": student.call_status.value,
            "call_duration": student.call_duration,
            "call_attempts": student.call_attempts,
            "sentiment": student.sentiment.value if student.sentiment else None,
            "interest_score": student.interest_score,
            "admission_probability": student.admission_probability,
            "called_at": student.called_at.isoformat() if student.called_at else None
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting student: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    session: AsyncSession = Depends(get_database)
):
    """Delete a student."""
    try:
        result = await session.execute(
            select(Student).where(Student.id == student_id)
        )
        student = result.scalar_one_or_none()
        
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        campaign_id = student.campaign_id
        
        await session.delete(student)
        await session.commit()
        
        # Update campaign statistics
        from app.campaign.campaign_service import CampaignService
        campaign_service = CampaignService()
        await campaign_service.update_campaign_statistics(session, campaign_id)
        
        return {"message": "Student deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting student: {e}")
        raise HTTPException(status_code=500, detail=str(e))
