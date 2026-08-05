"""
JSON Knowledge Retriever - For Testing Console
Uses hardcoded JSON files in backend/knowledge/ directory.
Separate from the main FAISS-based retriever used for real applications.
"""

import json
import os
from typing import List, Dict, Optional
from pathlib import Path

from app.logs.logger import get_logger

logger = get_logger(__name__)

KNOWLEDGE_DIR = Path(__file__).parent.parent.parent / "knowledge"


class JSONRetriever:
    """Retrieves knowledge from JSON files for testing console."""
    
    def __init__(self, knowledge_file: str = "institute.json"):
        self.knowledge_file = knowledge_file
        self.knowledge_data: Dict = {}
        self._load_knowledge()
    
    def _load_knowledge(self):
        """Load knowledge from JSON file."""
        knowledge_path = KNOWLEDGE_DIR / self.knowledge_file
        
        if not knowledge_path.exists():
            logger.error(f"Knowledge file not found: {knowledge_path}")
            self.knowledge_data = {
                "institute_name": "Unknown Institute",
                "greeting": "Hi! I'm Mrs.D, AI Admission Counsellor. How may I help you today?",
                "knowledge": []
            }
            return
        
        try:
            with open(knowledge_path, 'r', encoding='utf-8') as f:
                self.knowledge_data = json.load(f)
            logger.info(f"Loaded knowledge from {self.knowledge_file}")
            logger.info(f"Institute: {self.knowledge_data.get('institute_name', 'Unknown')}")
            logger.info(f"Knowledge chunks: {len(self.knowledge_data.get('knowledge', []))}")
        except Exception as e:
            logger.error(f"Error loading knowledge file: {e}")
            self.knowledge_data = {
                "institute_name": "Unknown Institute",
                "greeting": "Hi! I'm Mrs.D, AI Admission Counsellor. How may I help you today?",
                "knowledge": []
            }
    
    def get_institute_name(self) -> str:
        """Get institute name from knowledge file."""
        return self.knowledge_data.get("institute_name", "Unknown Institute")
    
    def get_greeting(self) -> str:
        """Get greeting from knowledge file."""
        return self.knowledge_data.get("greeting", "Hi! I'm Mrs.D, AI Admission Counsellor. How may I help you today?")
    
    def retrieve_context(self, query: str, top_k: int = 5) -> str:
        """
        Retrieve relevant knowledge chunks based on query.
        Simple keyword matching for JSON-based retriever.
        """
        knowledge_chunks = self.knowledge_data.get("knowledge", [])
        
        if not knowledge_chunks:
            return ""
        
        # Simple keyword matching
        query_lower = query.lower()
        scored_chunks = []
        
        for chunk in knowledge_chunks:
            content = chunk.get("content", "").lower()
            category = chunk.get("category", "").lower()
            
            # Calculate relevance score
            score = 0
            query_words = query_lower.split()
            
            for word in query_words:
                if word in content:
                    score += 1
                if word in category:
                    score += 2  # Category match is worth more
            
            if score > 0:
                scored_chunks.append((score, chunk))
        
        # Sort by score and return top-k
        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        top_chunks = [chunk for score, chunk in scored_chunks[:top_k]]
        
        # Format context
        if not top_chunks:
            return ""
        
        context_parts = []
        for chunk in top_chunks:
            category = chunk.get("category", "General")
            content = chunk.get("content", "")
            context_parts.append(f"[{category}] {content}")
        
        return "\n\n".join(context_parts)
    
    def add_knowledge(self, category: str, content: str):
        """
        Add new knowledge chunk to memory (for /insert command).
        Note: This doesn't persist to file, only for current session.
        """
        if "knowledge" not in self.knowledge_data:
            self.knowledge_data["knowledge"] = []
        
        self.knowledge_data["knowledge"].append({
            "category": category,
            "content": content
        })
        logger.info(f"Added knowledge: [{category}] {content}")
    
    def get_all_knowledge(self) -> str:
        """Get all knowledge as formatted text."""
        knowledge_chunks = self.knowledge_data.get("knowledge", [])
        
        if not knowledge_chunks:
            return ""
        
        context_parts = []
        for chunk in knowledge_chunks:
            category = chunk.get("category", "General")
            content = chunk.get("content", "")
            context_parts.append(f"[{category}] {content}")
        
        return "\n\n".join(context_parts)


# Global instance for testing console
_json_retriever: Optional[JSONRetriever] = None


def get_json_retriever(knowledge_file: str = "institute.json") -> JSONRetriever:
    """Get or create JSON retriever instance."""
    global _json_retriever
    
    if _json_retriever is None or _json_retriever.knowledge_file != knowledge_file:
        _json_retriever = JSONRetriever(knowledge_file)
    
    return _json_retriever
