"""
Conversation Memory - Manages per-call conversation context.
Stores only current call memory and clears after call ends.
"""

from typing import Dict, List, Optional
from datetime import datetime, timezone
from dataclasses import dataclass, field
from app.logs.logger import get_logger

logger = get_logger(__name__)


@dataclass
class ConversationMemory:
    """
    Per-call conversation memory.
    
    Stores:
    - Student name and details
    - Previous questions
    - Interest level
    - Preferred course
    - Language preference
    - Conversation history
    
    Memory is cleared after each call.
    """
    
    student_id: int
    student_name: str
    student_phone: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Conversation context
    conversation_history: List[Dict] = field(default_factory=list)
    questions_asked: List[str] = field(default_factory=list)
    objections: List[str] = field(default_factory=list)
    
    # Student preferences
    preferred_course: Optional[str] = None
    language: str = "en"
    interest_level: int = 0  # 0-100
    
    # Call metadata
    call_start_time: Optional[datetime] = None
    call_end_time: Optional[datetime] = None
    sentiment: str = "neutral"
    
    def add_message(self, role: str, content: str, timestamp: Optional[datetime] = None):
        """
        Add a message to conversation history.
        
        Args:
            role: 'user' (student) or 'assistant' (AI)
            content: Message content
            timestamp: Optional timestamp (defaults to now)
        """
        message = {
            "role": role,
            "content": content,
            "timestamp": (timestamp or datetime.now(timezone.utc)).isoformat()
        }
        self.conversation_history.append(message)
        
        # Keep only last 10 turns to manage context window
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]
    
    def add_question(self, question: str):
        """Add a student question to memory."""
        if question not in self.questions_asked:
            self.questions_asked.append(question)
    
    def add_objection(self, objection: str):
        """Add a student objection to memory."""
        if objection not in self.objections:
            self.objections.append(objection)
    
    def update_interest(self, level: int):
        """Update student interest level (0-100)."""
        self.interest_level = max(0, min(100, level))
    
    def set_preferred_course(self, course: str):
        """Set student's preferred course."""
        self.preferred_course = course
    
    def get_recent_history(self, turns: int = 6) -> List[Dict]:
        """
        Get recent conversation history.
        
        Args:
            turns: Number of recent turns to return
            
        Returns:
            List of recent messages
        """
        return self.conversation_history[-turns * 2:] if self.conversation_history else []
    
    def get_summary(self) -> Dict:
        """
        Get conversation summary.
        
        Returns:
            Dict with conversation summary
        """
        duration = None
        if self.call_start_time and self.call_end_time:
            duration = (self.call_end_time - self.call_start_time).total_seconds()
        
        return {
            "student_id": self.student_id,
            "student_name": self.student_name,
            "duration_seconds": duration,
            "message_count": len(self.conversation_history),
            "questions_count": len(self.questions_asked),
            "objections_count": len(self.objections),
            "interest_level": self.interest_level,
            "preferred_course": self.preferred_course,
            "sentiment": self.sentiment,
            "language": self.language
        }
    
    def clear(self):
        """Clear all memory (called after call ends)."""
        self.conversation_history.clear()
        self.questions_asked.clear()
        self.objections.clear()
        self.interest_level = 0
        self.preferred_course = None
        self.call_start_time = None
        self.call_end_time = None
        self.sentiment = "neutral"
        logger.info(f"Conversation memory cleared for student {self.student_name}")
    
    def start_call(self):
        """Mark call as started."""
        self.call_start_time = datetime.now(timezone.utc)
    
    def end_call(self):
        """Mark call as ended."""
        self.call_end_time = datetime.now(timezone.utc)
