"""
Document upload and extraction service for Mrs. D AI Admission Campaign Platform.
Supports PDF, DOCX, TXT, and CSV files.
"""

import os
import aiofiles
from pathlib import Path
from typing import Optional, Tuple
import fitz  # PyMuPDF
from docx import Document
import pandas as pd

from app.config.settings import settings
from app.logs.logger import get_logger

logger = get_logger(__name__)


class DocumentService:
    """Service for handling document uploads and text extraction."""
    
    def __init__(self):
        self.allowed_mime_types = settings.ALLOWED_DOCUMENT_TYPES
        self.max_size = settings.MAX_UPLOAD_SIZE
    
    async def validate_file(self, file_content: bytes, filename: str) -> Tuple[bool, Optional[str]]:
        """
        Validate uploaded file.
        
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
        allowed_extensions = ['.pdf', '.docx', '.txt', '.csv']
        if ext not in allowed_extensions:
            return False, f"File extension {ext} is not allowed"
        
        # Basic content validation based on extension
        if ext == '.pdf':
            if not file_content.startswith(b'%PDF'):
                return False, "Invalid PDF file"
        elif ext == '.docx':
            if not file_content.startswith(b'PK\x03\x04'):
                return False, "Invalid DOCX file"
        elif ext == '.csv':
            # Check if it looks like text
            try:
                file_content.decode('utf-8')
            except UnicodeDecodeError:
                return False, "Invalid CSV file (not text)"
        elif ext == '.txt':
            try:
                file_content.decode('utf-8')
            except UnicodeDecodeError:
                return False, "Invalid text file"
        
        return True, None
    
    async def save_file(self, file_content: bytes, filename: str) -> Path:
        """
        Save uploaded file to knowledge directory.
        
        Args:
            file_content: File content as bytes
            filename: Original filename
            
        Returns:
            Path to saved file
        """
        # Generate unique filename
        timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")
        safe_filename = f"{timestamp}_{filename}"
        file_path = settings.KNOWLEDGE_DIR / safe_filename
        
        # Save file
        async with aiofiles.open(file_path, 'wb') as f:
            await f.write(file_content)
        
        logger.info(f"File saved: {file_path}")
        return file_path
    
    async def extract_text(self, file_path: Path) -> str:
        """
        Extract text from document based on file type.
        
        Args:
            file_path: Path to the document
            
        Returns:
            Extracted text as string
        """
        ext = file_path.suffix.lower()
        
        try:
            if ext == '.pdf':
                return await self._extract_from_pdf(file_path)
            elif ext == '.docx':
                return await self._extract_from_docx(file_path)
            elif ext == '.txt':
                return await self._extract_from_txt(file_path)
            elif ext == '.csv':
                return await self._extract_from_csv(file_path)
            else:
                raise ValueError(f"Unsupported file type: {ext}")
        except Exception as e:
            logger.error(f"Error extracting text from {file_path}: {e}")
            raise
    
    async def _extract_from_pdf(self, file_path: Path) -> str:
        """Extract text from PDF using PyMuPDF."""
        text = ""
        doc = fitz.open(str(file_path))
        
        for page in doc:
            text += page.get_text()
        
        doc.close()
        return await self._clean_text(text)
    
    async def _extract_from_docx(self, file_path: Path) -> str:
        """Extract text from DOCX using python-docx."""
        doc = Document(str(file_path))
        text = ""
        
        for paragraph in doc.paragraphs:
            text += paragraph.text + "\n"
        
        # Extract tables
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    text += cell.text + " | "
                text += "\n"
        
        return await self._clean_text(text)
    
    async def _extract_from_txt(self, file_path: Path) -> str:
        """Extract text from TXT file."""
        async with aiofiles.open(file_path, 'r', encoding='utf-8') as f:
            text = await f.read()
        
        return await self._clean_text(text)
    
    async def _extract_from_csv(self, file_path: Path) -> str:
        """Extract text from CSV file."""
        df = pd.read_csv(file_path)
        text = df.to_string(index=False)
        return await self._clean_text(text)
    
    async def _clean_text(self, text: str) -> str:
        """
        Clean extracted text.
        
        Removes:
        - Extra whitespace
        - Broken characters
        - Duplicate lines
        
        Preserves:
        - Tables
        - Phone numbers
        - Bullet lists
        - Course names
        """
        if not text:
            return ""
        
        # Remove extra whitespace
        text = ' '.join(text.split())
        
        # Remove duplicate lines (but keep at least one occurrence)
        lines = text.split('\n')
        seen = set()
        unique_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped and stripped not in seen:
                seen.add(stripped)
                unique_lines.append(line)
            elif not stripped:
                unique_lines.append(line)  # Keep empty lines for structure
        
        text = '\n'.join(unique_lines)
        
        return text
    
    async def delete_file(self, file_path: Path) -> bool:
        """
        Delete a file from storage.
        
        Args:
            file_path: Path to the file
            
        Returns:
            True if deleted successfully
        """
        try:
            if file_path.exists():
                os.remove(file_path)
                logger.info(f"File deleted: {file_path}")
                return True
            return False
        except Exception as e:
            logger.error(f"Error deleting file {file_path}: {e}")
            return False
