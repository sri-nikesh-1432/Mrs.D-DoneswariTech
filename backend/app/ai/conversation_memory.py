"""
Conversation Memory Service - Maintains conversation context during calls.
Stores conversation history, student information, and call state.
"""

from typing import List, Dict, Optional
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum


class CallStage(Enum):
    """Stages of a call conversation."""
    GREETING = "greeting"
    INTRODUCTION = "introduction"
    INSTITUTE_PROMOTION = "institute_promotion"
    STUDENT_QUESTIONS = "student_questions"
    OBJECTION_HANDLING = "objection_handling"
    INTEREST_ASSESSMENT = "interest_assessment"
    CLOSING = "closing"
    ENDED = "ended"


@dataclass
class ConversationMemory:
    """Memory for a single conversation with a student."""
    
    # Student information
    student_id: int
    student_name: str
    student_phone: str
    preferred_course: Optional[str] = None
    
    # Conversation history
    conversation_history: List[Dict] = field(default_factory=list)
    
    # Call state
    current_stage: CallStage = CallStage.GREETING
    started_at: datetime = field(default_factory=datetime.utcnow)
    
    # Context tracking
    topics_discussed: List[str] = field(default_factory=list)
    questions_asked: List[str] = field(default_factory=list)
    objections_raised: List[str] = field(default_factory=list)
    
    # Interest assessment
    interest_level: int = 50  # 0-100
    admission_probability: float = 0.5  # 0.0-1.0
    
    # Notes
    notes: List[str] = field(default_factory=list)
    
    def add_message(self, role: str, content: str):
        """
        Add a message to the conversation history.
        
        Args:
            role: 'user' or 'assistant'
            content: Message content
        """
        self.conversation_history.append({
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow().isoformat()
        })
    
    def get_recent_history(self, limit: int = 5) -> List[Dict]:
        """
        Get recent conversation history.
        
        Args:
            limit: Number of recent messages to return
            
        Returns:
            List of recent messages
        """
        return self.conversation_history[-limit:] if self.conversation_history else []
    
    def get_full_history(self) -> List[Dict]:
        """Get the full conversation history."""
        return self.conversation_history
    
    def update_stage(self, stage: CallStage):
        """
        Update the current call stage.
        
        Args:
            stage: New call stage
        """
        self.current_stage = stage
    
    def add_topic(self, topic: str):
        """
        Add a topic to the list of discussed topics.
        
        Args:
            topic: Topic discussed
        """
        if topic not in self.topics_discussed:
            self.topics_discussed.append(topic)
    
    def add_question(self, question: str):
        """
        Add a question asked by the student.
        
        Args:
            question: Question text
        """
        self.questions_asked.append(question)
    
    def add_objection(self, objection: str):
        """
        Add an objection raised by the student.
        
        Args:
            objection: Objection text
        """
        if objection not in self.objections_raised:
            self.objections_raised.append(objection)
    
    def update_interest(self, delta: int):
        """
        Update interest level by a delta amount.
        
        Args:
            delta: Amount to add/subtract from interest level
        """
        self.interest_level = max(0, min(100, self.interest_level + delta))
        self.admission_probability = self.interest_level / 100.0
    
    def set_interest(self, level: int):
        """
        Set interest level directly.
        
        Args:
            level: Interest level (0-100)
        """
        self.interest_level = max(0, min(100, level))
        self.admission_probability = self.interest_level / 100.0
    
    def add_note(self, note: str):
        """
        Add a note about the conversation.
        
        Args:
            note: Note text
        """
        self.notes.append(note)
    
    def get_summary(self) -> Dict:
        """
        Get a summary of the conversation memory.
        
        Returns:
            Dictionary with conversation summary
        """
        return {
            "student_id": self.student_id,
            "student_name": self.student_name,
            "current_stage": self.current_stage.value,
            "duration_seconds": (datetime.utcnow() - self.started_at).total_seconds(),
            "message_count": len(self.conversation_history),
            "topics_discussed": self.topics_discussed,
            "questions_asked": self.questions_asked,
            "objections_raised": self.objections_raised,
            "interest_level": self.interest_level,
            "admission_probability": self.admission_probability,
            "notes": self.notes
        }
    
    def clear(self):
        """Clear the conversation memory."""
        self.conversation_history.clear()
        self.topics_discussed.clear()
        self.questions_asked.clear()
        self.objections_raised.clear()
        self.notes.clear()
        self.current_stage = CallStage.GREETING
        self.interest_level = 50
        self.admission_probability = 0.5


class ConversationMemoryManager:
    """Manages conversation memories for multiple active calls."""
    
    def __init__(self):
        self.memories: Dict[int, ConversationMemory] = {}  # student_id -> memory
    
    def create_memory(
        self,
        student_id: int,
        student_name: str,
        student_phone: str,
        preferred_course: Optional[str] = None
    ) -> ConversationMemory:
        """
        Create a new conversation memory for a student.
        
        Args:
            student_id: Student ID
            student_name: Student name
            student_phone: Student phone number
            preferred_course: Preferred course (optional)
            
        Returns:
            ConversationMemory instance
        """
        memory = ConversationMemory(
            student_id=student_id,
            student_name=student_name,
            student_phone=student_phone,
            preferred_course=preferred_course
        )
        self.memories[student_id] = memory
        return memory
    
    def get_memory(self, student_id: int) -> Optional[ConversationMemory]:
        """
        Get conversation memory for a student.
        
        Args:
            student_id: Student ID
            
        Returns:
            ConversationMemory instance or None
        """
        return self.memories.get(student_id)
    
    def remove_memory(self, student_id: int) -> bool:
        """
        Remove conversation memory for a student.
        
        Args:
            student_id: Student ID
            
        Returns:
            True if memory was removed
        """
        if student_id in self.memories:
            del self.memories[student_id]
            return True
        return False
    
    def clear_all(self):
        """Clear all conversation memories."""
        self.memories.clear()


# Global conversation memory manager instance
conversation_memory_manager = ConversationMemoryManager()
