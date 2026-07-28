"""
Gemini LLM Service — Handles conversation, reasoning, and summarization.
Uses Google Gemini API with RAG context injection.
"""

import json
import asyncio
from typing import List, Dict, Optional, AsyncGenerator
import google.generativeai as genai

from app.config import settings
from app.utils.logger import get_logger
from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
from app.rag.prompt_builder import build_prompt, SYSTEM_PROMPT

logger = get_logger(__name__)

_model = None


def _get_model():
    """Lazy-init the Gemini model."""
    global _model
    if _model is None:
        if not settings.is_gemini_configured:
            raise ValueError("GEMINI_API_KEY is not configured. Set it in .env")
        genai.configure(api_key=settings.GEMINI_API_KEY)
        _model = genai.GenerativeModel(
            model_name=settings.GEMINI_MODEL,
            generation_config={
                "temperature": 0.7,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 8192,
            },
            safety_settings={
                "HARASSMENT": "BLOCK_NONE",
                "HATE_SPEECH": "BLOCK_NONE",
                "SEXUALLY_EXPLICIT": "BLOCK_NONE",
                "DANGEROUS_CONTENT": "BLOCK_NONE",
            },
        )
        logger.info("Gemini model initialized: %s", settings.GEMINI_MODEL)
    return _model


async def chat(
    query: str,
    student_info: Optional[Dict] = None,
    conversation_history: Optional[List[Dict]] = None,
    use_rag: bool = True,
) -> str:
    """
    Send a query to Gemini with RAG context and conversation history.
    
    Args:
        query: The student's message
        student_info: Dict with student details
        conversation_history: Previous conversation turns
        use_rag: Whether to retrieve context from knowledge base
        
    Returns:
        Gemini's response text
    """
    try:
        # Retrieve relevant context
        context = ""
        if use_rag and is_knowledge_ready():
            retrieved = await retrieve_context(query)
            context = format_context_for_prompt(retrieved)
            logger.debug("Retrieved %d chunks for query", len(retrieved))

        # Build prompt
        messages = build_prompt(query, context, student_info, conversation_history)

        # Get Gemini response
        model = _get_model()
        response = await model.generate_content_async(
            contents=messages,
        )

        answer = response.text.strip()
        logger.debug("Gemini response: %d chars", len(answer))
        return answer

    except Exception as e:
        logger.error("Gemini chat failed: %s", e)
        raise


async def generate_summary(transcript: str) -> Dict:
    """
    Generate a structured summary of a call transcript.
    
    Args:
        transcript: The full call transcript
        
    Returns:
        Dict with summary, sentiment, interest score, etc.
    """
    from app.rag.prompt_builder import BUILD_CONTEXT_PROMPT
    prompt = BUILD_CONTEXT_PROMPT.format(transcript=transcript)

    try:
        model = _get_model()
        response = await model.generate_content_async(prompt)

        text = response.text.strip()
        # Try to extract JSON from the response
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()

        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            # Fallback to default values
            result = {
                "summary": text[:500],
                "sentiment": "neutral",
                "interest_score": 50,
                "admission_probability": 0.5,
                "questions_asked": [],
                "objections": [],
                "recommended_follow_up": "General follow-up recommended",
                "notes": text[:500],
            }

        return result

    except Exception as e:
        logger.error("Summary generation failed: %s", e)
        return {
            "summary": "Summary generation failed",
            "sentiment": "neutral",
            "interest_score": 0,
            "admission_probability": 0.0,
            "questions_asked": [],
            "objections": [],
            "recommended_follow_up": "Manual review required",
            "notes": str(e),
        }
