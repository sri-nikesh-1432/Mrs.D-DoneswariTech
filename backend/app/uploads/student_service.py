"""
Student import service for Mrs. D AI Admission Campaign Platform.
Supports Excel and CSV files with validation.
"""

import os
import aiofiles
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import pandas as pd
import phonenumbers
from phonenumbers import NumberParseException

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class StudentService:
    """Service for handling student list uploads and validation."""
    
    def __init__(self):
        self.allowed_mime_types = settings.ALLOWED_STUDENT_TYPES
        self.max_size = settings.MAX_UPLOAD_SIZE
    
    async def validate_file(self, file_content: bytes, filename: str) -> Tuple[bool, Optional[str]]:
        """
        Validate uploaded student file.
        
        Args:
            file_content: File content as bytes
            filename: Original filename
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        # Check file size
        if len(file_content) > self.max_size:
            return False, f"File size exceeds maximum limit of {self.max_size / (1024 * 1024)}MB"
        
        # Check file extension
        ext = Path(filename).suffix.lower()
        allowed_extensions = ['.xlsx', '.xls', '.csv']
        if ext not in allowed_extensions:
            return False, f"File extension {ext} is not allowed. Allowed types: {', '.join(allowed_extensions)}"
        
        return True, None
    
    async def save_file(self, file_content: bytes, filename: str) -> Path:
        """
        Save uploaded student file to students directory.
        
        Args:
            file_content: File content as bytes
            filename: Original filename
            
        Returns:
            Path to saved file
        """
        # Generate unique filename
        timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{timestamp}_{filename}"
        file_path = settings.STUDENTS_DIR / safe_filename
        
        # Save file
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(file_content)
        
        logger.info(f"Student file saved: {file_path}")
        return file_path
    
    async def parse_students(self, file_path: Path) -> Tuple[List[Dict], List[str]]:
        """
        Parse student data from Excel or CSV file.
        
        Args:
            file_path: Path to the student file
            
        Returns:
            Tuple of (students_list, error_messages)
        """
        ext = file_path.suffix.lower()
        
        try:
            if ext in ['.xlsx', '.xls']:
                df = pd.read_excel(file_path)
            elif ext == '.csv':
                df = pd.read_csv(file_path)
            else:
                raise ValueError(f"Unsupported file type: {ext}")
            
            # Normalize column names
            df.columns = df.columns.str.strip().str.lower()
            
            # Check required columns
            required_columns = ['student name', 'phone number']
            missing_columns = [col for col in required_columns if col not in df.columns]
            
            if missing_columns:
                return [], f"Missing required columns: {', '.join(missing_columns)}"
            
            # Map columns to standard names
            column_map = {
                'student name': 'name',
                'phone number': 'phone',
                'phone': 'phone',
                'interested course': 'preferred_course',
                'course': 'preferred_course',
                'email': 'email',
                'city': 'city',
                'state': 'state',
                'notes': 'notes'
            }
            
            # Rename columns
            df = df.rename(columns=column_map)
            
            # Convert to list of dictionaries
            students = df.to_dict('records')
            
            # Validate students
            valid_students = []
            errors = []
            
            for idx, student in enumerate(students, start=1):
                validation_result = await self._validate_student(student, idx)
                if validation_result[0]:
                    valid_students.append(validation_result[1])
                else:
                    errors.append(validation_result[1])
            
            logger.info(f"Parsed {len(valid_students)} valid students from {file_path}")
            return valid_students, errors
        
        except Exception as e:
            logger.error(f"Error parsing student file {file_path}: {e}")
            return [], [f"Error parsing file: {str(e)}"]
    
    async def _validate_student(self, student: Dict, row_number: int) -> Tuple[bool, Dict]:
        """
        Validate individual student data.
        
        Args:
            student: Student data dictionary
            row_number: Row number for error reporting
            
        Returns:
            Tuple of (is_valid, student_data_or_error_message)
        """
        # Check required fields
        if not student.get('name') or pd.isna(student.get('name')):
            return False, f"Row {row_number}: Missing student name"
        
        if not student.get('phone') or pd.isna(student.get('phone')):
            return False, f"Row {row_number}: Missing phone number"
        
        # Validate phone number
        phone = str(student['phone']).strip()
        try:
            # Parse phone number (assuming default region, can be configured)
            parsed_phone = phonenumbers.parse(phone, None)
            if not phonenumbers.is_valid_number(parsed_phone):
                return False, f"Row {row_number}: Invalid phone number format"
            
            # Format to E.164 format
            student['phone'] = phonenumbers.format_number(parsed_phone, phonenumbers.PhoneNumberFormat.E164)
        
        except NumberParseException:
            return False, f"Row {row_number}: Invalid phone number format"
        
        # Clean and validate other fields
        student['name'] = str(student['name']).strip()
        student['email'] = str(student.get('email', '')).strip() if student.get('email') and not pd.isna(student.get('email')) else None
        student['preferred_course'] = str(student.get('preferred_course', '')).strip() if student.get('preferred_course') and not pd.isna(student.get('preferred_course')) else None
        student['city'] = str(student.get('city', '')).strip() if student.get('city') and not pd.isna(student.get('city')) else None
        student['state'] = str(student.get('state', '')).strip() if student.get('state') and not pd.isna(student.get('state')) else None
        student['notes'] = str(student.get('notes', '')).strip() if student.get('notes') and not pd.isna(student.get('notes')) else None
        
        return True, student
    
    async def remove_duplicates(self, students: List[Dict]) -> Tuple[List[Dict], int]:
        """
        Remove duplicate students based on phone number.
        
        Args:
            students: List of student dictionaries
            
        Returns:
            Tuple of (unique_students, duplicates_removed_count)
        """
        seen_phones = set()
        unique_students = []
        
        for student in students:
            phone = student['phone']
            if phone not in seen_phones:
                seen_phones.add(phone)
                unique_students.append(student)
        
        duplicates_removed = len(students) - len(unique_students)
        logger.info(f"Removed {duplicates_removed} duplicate students")
        
        return unique_students, duplicates_removed
    
    async def delete_file(self, file_path: Path) -> bool:
        """
        Delete a student file from storage.
        
        Args:
            file_path: Path to the file
            
        Returns:
            True if deleted successfully
        """
        try:
            if file_path.exists():
                os.remove(file_path)
                logger.info(f"Student file deleted: {file_path}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting student file {file_path}: {e}")
            return False
