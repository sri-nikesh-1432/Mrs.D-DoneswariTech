"""
Student import and management API endpoints.
Supports Excel and CSV upload with validation.
"""

import os
import uuid
import json
import pandas as pd
from typing import List, Dict
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from app.config import settings
from app.campaign.manager import campaign_manager
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}


@router.post("/upload-students")
async def upload_students(
    file: UploadFile = File(...),
    campaign_id: int = Form(...),
):
    """
    Upload a student list (Excel or CSV) for a campaign.
    Expected columns: name, phone (required), preferred_course, email, city
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file
    contents = await file.read()

    # Save temporarily
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(settings.UPLOADS_DIR, unique_name)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "wb") as f:
        f.write(contents)

    try:
        # Parse the file
        if ext == ".csv":
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)

        # Normalize column names
        df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]

        # Map expected columns
        col_map = _map_columns(df.columns.tolist())
        if not col_map.get("name") or not col_map.get("phone"):
            raise HTTPException(
                status_code=400,
                detail="File must contain 'name' and 'phone' columns. Found: " + ", ".join(df.columns.tolist())
            )

        # Extract students
        students_data = []
        for _, row in df.iterrows():
            student = {
                "name": str(row.get(col_map["name"], "")).strip(),
                "phone": str(row.get(col_map["phone"], "")).strip(),
                "preferred_course": str(row.get(col_map.get("preferred_course", ""), "")).strip(),
                "email": str(row.get(col_map.get("email", ""), "")).strip(),
                "city": str(row.get(col_map.get("city", ""), "")).strip(),
                "state": str(row.get(col_map.get("state", ""), "")).strip(),
                "notes": str(row.get(col_map.get("notes", ""), "")).strip(),
            }
            students_data.append(student)

        # Import students
        result = await campaign_manager.import_students(campaign_id, students_data)

        return {
            "success": True,
            "message": f"Imported {result.get('imported', 0)} students",
            "imported": result.get("imported", 0),
            "skipped": result.get("skipped", 0),
            "errors": result.get("errors", []),
            "total": len(students_data),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Student import failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")
    finally:
        # Clean up temporary file
        if os.path.exists(file_path):
            os.remove(file_path)


@router.get("/students")
async def get_students(campaign_id: int = Query(...)):
    """Get all students for a campaign."""
    students = await campaign_manager.get_students(campaign_id)
    return {"students": students, "total": len(students)}


def _map_columns(columns: List[str]) -> Dict[str, str]:
    """Map found column names to expected fields."""
    mapping = {}
    for col in columns:
        col_lower = col.lower().strip()
        if col_lower in ("name", "student_name", "student name", "full_name", "full name"):
            mapping["name"] = col
        elif col_lower in ("phone", "phone_number", "phone number", "mobile", "mobile_number", "contact", "contact_number"):
            mapping["phone"] = col
        elif col_lower in ("course", "preferred_course", "preferred course", "interested_course", "course_of_interest"):
            mapping["preferred_course"] = col
        elif col_lower in ("email", "email_address", "email address", "e_mail"):
            mapping["email"] = col
        elif col_lower in ("city", "town", "location"):
            mapping["city"] = col
        elif col_lower in ("state", "province"):
            mapping["state"] = col
        elif col_lower in ("notes", "remarks", "comments", "additional_notes"):
            mapping["notes"] = col
    return mapping
