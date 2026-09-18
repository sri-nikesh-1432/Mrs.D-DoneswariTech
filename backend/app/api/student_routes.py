"""
Student Management API Routes for Doneswari AI Telecaller Platform.
Handles CSV/XLSX validation preview, bulk import, manual entry, and contact queries.
"""

import io
import os
import re
from typing import Optional, List, Dict
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database
from app.database.models import Student, Institute, CallHistory
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["Students"])


# ── Phone & Name Validation Helpers ──────────────────────────────────────────

def _clean_phone(phone_raw: str) -> Optional[str]:
    """Normalize and validate phone numbers."""
    if not phone_raw or pd.isna(phone_raw):
        return None
    # Remove whitespace, dashes, parens
    cleaned = re.sub(r"[^\d+]", "", str(phone_raw).strip())
    # Require 10 to 15 digits
    digits_only = re.sub(r"\D", "", cleaned)
    if 10 <= len(digits_only) <= 15:
        if not cleaned.startswith("+"):
            # Default to +91 if 10 digits
            if len(digits_only) == 10:
                cleaned = f"+91{digits_only}"
            else:
                cleaned = f"+{digits_only}"
        return cleaned
    return None


def _clean_name(name_raw: str) -> Optional[str]:
    """Clean and validate student name."""
    if not name_raw or pd.isna(name_raw):
        return None
    cleaned = str(name_raw).strip()
    if len(cleaned) < 2 or re.match(r"^[\d\W]+$", cleaned):
        return None
    return cleaned


# ── Schemas ──────────────────────────────────────────────────────────────────

class StudentCreateRequest(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    preferred_course: Optional[str] = None
    city: Optional[str] = None
    notes: Optional[str] = None


class StudentBatchImportRequest(BaseModel):
    students: List[Dict]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/api/agents/{agent_id}/students/validate")
async def validate_students_file(
    agent_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_database),
):
    """
    Validate uploaded student CSV or Excel file.
    Returns preview with counts of valid, invalid, and duplicate entries before committing.
    """
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    content_bytes = await file.read()
    ext = os.path.splitext(file.filename)[1].lower()

    try:
        if ext in {".xlsx", ".xls"}:
            df = pd.read_excel(io.BytesIO(content_bytes))
        elif ext == ".csv":
            df = pd.read_csv(io.BytesIO(content_bytes))
        else:
            raise HTTPException(status_code=400, detail="Only CSV and XLSX files are supported")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    # Normalize column names
    col_map = {}
    for col in df.columns:
        c_lower = str(col).strip().lower().replace("_", " ")
        if "name" in c_lower or "student" in c_lower:
            col_map[col] = "name"
        elif "phone" in c_lower or "mobile" in c_lower or "contact" in c_lower or "number" in c_lower:
            col_map[col] = "phone"
        elif "course" in c_lower or "program" in c_lower or "class" in c_lower:
            col_map[col] = "preferred_course"
        elif "email" in c_lower:
            col_map[col] = "email"
        elif "city" in c_lower or "location" in c_lower:
            col_map[col] = "city"

    df = df.rename(columns=col_map)
    if "name" not in df.columns or "phone" not in df.columns:
        raise HTTPException(
            status_code=400,
            detail="File must contain 'Student Name' and 'Phone Number' columns",
        )

    # Get existing phone numbers for this agent to detect duplicates
    existing_phones_query = await session.execute(
        select(Student.phone).where(Student.agent_id == agent_id)
    )
    existing_phones = set(existing_phones_query.scalars().all())

    seen_in_file = set()
    valid_rows = []
    invalid_rows = []
    duplicates_count = 0

    for idx, row in df.iterrows():
        raw_name = row.get("name")
        raw_phone = row.get("phone")
        clean_n = _clean_name(raw_name)
        clean_p = _clean_phone(raw_phone)

        row_data = {
            "row_number": idx + 2,
            "name": clean_n or str(raw_name or ""),
            "phone": clean_p or str(raw_phone or ""),
            "preferred_course": str(row.get("preferred_course", "")).strip() if pd.notna(row.get("preferred_course")) else "",
            "city": str(row.get("city", "")).strip() if pd.notna(row.get("city")) else "",
            "email": str(row.get("email", "")).strip() if pd.notna(row.get("email")) else "",
        }

        if not clean_n:
            invalid_rows.append({"row": idx + 2, "name": str(raw_name or ""), "reason": "Missing or invalid name"})
            continue

        if not clean_p:
            invalid_rows.append({"row": idx + 2, "phone": str(raw_phone or ""), "reason": "Invalid phone number (must be 10-15 digits)"})
            continue

        if clean_p in seen_in_file or clean_p in existing_phones:
            duplicates_count += 1
            invalid_rows.append({"row": idx + 2, "phone": clean_p, "reason": "Duplicate phone number"})
            continue

        seen_in_file.add(clean_p)
        valid_rows.append(row_data)

    return {
        "filename": file.filename,
        "total_rows": len(df),
        "valid_count": len(valid_rows),
        "invalid_count": len(invalid_rows),
        "duplicates_count": duplicates_count,
        "preview_valid": valid_rows[:10],
        "errors": invalid_rows[:10],
        "valid_records": valid_rows,  # Client can confirm to import these
    }


@router.post("/api/agents/{agent_id}/students/import")
async def import_validated_students(
    agent_id: int,
    body: StudentBatchImportRequest,
    session: AsyncSession = Depends(get_database),
):
    """Commit pre-validated student list to database."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    imported_count = 0
    for item in body.students:
        name = _clean_name(item.get("name"))
        phone = _clean_phone(item.get("phone"))
        if not name or not phone:
            continue

        student = Student(
            agent_id=agent.id,
            name=name,
            phone=phone,
            email=item.get("email"),
            preferred_course=item.get("preferred_course"),
            city=item.get("city"),
            call_status="Pending",
            interest_level="Unclear",
        )
        session.add(student)
        imported_count += 1

    agent.total_students = (agent.total_students or 0) + imported_count
    await session.commit()

    return {
        "imported": imported_count,
        "total_students": agent.total_students,
        "message": f"Successfully imported {imported_count} student contacts.",
    }


@router.post("/api/agents/{agent_id}/students")
async def add_student_manually(
    agent_id: int,
    body: StudentCreateRequest,
    session: AsyncSession = Depends(get_database),
):
    """Add a student contact manually."""
    agent = await session.get(Institute, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    name = _clean_name(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Valid student name is required")

    phone = _clean_phone(body.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Valid phone number is required (10-15 digits)")

    # Check existing phone
    existing = await session.execute(
        select(Student).where(Student.agent_id == agent_id, Student.phone == phone)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A student with this phone number already exists")

    student = Student(
        agent_id=agent.id,
        name=name,
        phone=phone,
        email=body.email,
        preferred_course=body.preferred_course,
        city=body.city,
        notes=body.notes,
        call_status="Pending",
        interest_level="Unclear",
    )
    session.add(student)
    agent.total_students = (agent.total_students or 0) + 1
    await session.commit()
    await session.refresh(student)

    return {
        "id": student.id,
        "name": student.name,
        "phone": student.phone,
        "preferred_course": student.preferred_course,
        "city": student.city,
        "call_status": student.call_status,
        "interest_level": student.interest_level,
    }


@router.get("/api/agents/{agent_id}/students")
async def list_students(
    agent_id: int,
    search: Optional[str] = None,
    call_status: Optional[str] = None,
    interest_level: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    session: AsyncSession = Depends(get_database),
):
    """List students with search and filter capabilities."""
    query = select(Student).where(Student.agent_id == agent_id)

    if call_status and call_status.lower() != "all":
        query = query.where(func.lower(Student.call_status) == call_status.lower())

    if interest_level and interest_level.lower() != "all":
        query = query.where(func.lower(Student.interest_level) == interest_level.lower())

    if search:
        s = f"%{search.strip().lower()}%"
        query = query.where((func.lower(Student.name).like(s)) | (Student.phone.like(s)))

    query = query.order_by(Student.id.desc()).offset(offset).limit(limit)
    result = await session.execute(query)
    students = result.scalars().all()

    # Total count
    count_query = select(func.count(Student.id)).where(Student.agent_id == agent_id)
    total_count = (await session.execute(count_query)).scalar() or 0

    return {
        "total": total_count,
        "students": [
            {
                "id": s.id,
                "name": s.name,
                "phone": s.phone,
                "email": s.email,
                "preferred_course": s.preferred_course,
                "city": s.city,
                "call_status": s.call_status,
                "interest_level": s.interest_level,
                "duration_seconds": s.duration_seconds,
                "questions_asked": s.questions_asked or [],
                "objections": s.objections or [],
                "callback_requested": s.callback_requested,
                "outcome": s.outcome,
                "last_called_at": s.last_called_at.isoformat() if s.last_called_at else None,
            }
            for s in students
        ]
    }


@router.delete("/api/agents/{agent_id}/students/{student_id}")
async def delete_student(
    agent_id: int,
    student_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Delete a single student contact."""
    student = await session.get(Student, student_id)
    if not student or student.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Student not found")

    await session.delete(student)
    agent = await session.get(Institute, agent_id)
    if agent and agent.total_students and agent.total_students > 0:
        agent.total_students -= 1

    await session.commit()
    return {"message": "Student deleted successfully"}


@router.delete("/api/agents/{agent_id}/students")
async def clear_all_students(
    agent_id: int,
    session: AsyncSession = Depends(get_database),
):
    """Clear all students for an agent."""
    from sqlalchemy import delete
    await session.execute(delete(Student).where(Student.agent_id == agent_id))
    agent = await session.get(Institute, agent_id)
    if agent:
        agent.total_students = 0
    await session.commit()
    return {"message": "All students cleared successfully"}
