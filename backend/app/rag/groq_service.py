"""
Groq LLM Service — Handles conversation, reasoning, and summarization.
Uses Groq API with RAG context injection.
"""

import json
import asyncio
from typing import List, Dict, Optional, AsyncGenerator
from groq import AsyncGroq

from app.config.settings import settings
from app.logs.logger import get_logger
from app.rag.retriever import retrieve_context, format_context_for_prompt, is_knowledge_ready
from app.rag.prompt_builder import build_prompt, SYSTEM_PROMPT

logger = get_logger(__name__)

_client = None


def _model_chain() -> list:
    """Primary model first, then fallbacks (deduplicated)."""
    models = [settings.GROQ_MODEL] + list(settings.GROQ_FALLBACK_MODELS or [])
    seen = []
    for m in models:
        if m and m not in seen:
            seen.append(m)
    return seen or ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]


def _is_rate_limit(e: Exception) -> bool:
    """True for Groq 429 (per-model token cap) — the ONLY error worth retrying
    on a different model. Connection errors are retried on the same request;
    auth/validation errors must surface immediately."""
    if getattr(e, "status_code", None) == 429:
        return True
    name = type(e).__name__.lower()
    return "ratelimit" in name or "429" in str(e)[:60]


async def _create_with_fallback(
    messages: List[Dict],
    temperature: float = 0.5,
    max_tokens: int = 1024,
    stream: bool = False,
):
    """
    Create a Groq completion, automatically falling back to the next model in
    the chain when the current one is rate-limited. Free-tier Groq caps tokens
    per DAY per model, so a 429 must switch models instead of killing the call.
    """
    client = _get_client()
    chain = _model_chain()
    last_exc = None
    for idx, model in enumerate(chain):
        try:
            return await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=stream,
            )
        except Exception as e:
            last_exc = e
            if _is_rate_limit(e) and idx < len(chain) - 1:
                logger.warning(
                    "Model %s rate-limited (%s); falling back to %s",
                    model, str(e)[:120], chain[idx + 1],
                )
                continue
            raise
    raise last_exc


async def stream_chat(
    query: str,
    conversation_history: Optional[List[Dict]] = None,
    provided_context: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Stream LLM completion tokens for a single turn (real-time voice).

    Yields text deltas as they arrive. `provided_context` (JSON/FAISS chunks)
    is passed straight to the prompt builder. Raises on final failure after
    the model fallback chain is exhausted.
    """
    messages = build_prompt(query, provided_context or "", None, conversation_history)
    try:
        stream = await _create_with_fallback(messages, stream=True)
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        logger.error("Streaming LLM failed: %s", e)
        raise


def _get_client():
    """Lazy-init the Groq client."""
    global _client
    if _client is None:
        logger.info(f"=== STEP 9: LLM INITIALIZATION ===")
        
        if not settings.GROQ_API_KEY or settings.GROQ_API_KEY == "":
            logger.error("✗ GROQ_API_KEY is not configured")
            logger.error("STEP 9 FAILED: Missing API key")
            raise ValueError("GROQ_API_KEY is not configured. Set it in .env")
        
        logger.info("✓ GROQ_API_KEY is configured")
        logger.info(f"Using model: {settings.GROQ_MODEL}")
        
        _client = AsyncGroq(api_key=settings.GROQ_API_KEY)
        logger.info("✓ Groq client initialized")
        logger.info(f"=== STEP 9 COMPLETE: LLM INITIALIZATION SUCCESSFUL ===")
    return _client


async def chat(
    query: str,
    student_info: Optional[Dict] = None,
    conversation_history: Optional[List[Dict]] = None,
    use_rag: bool = True,
    provided_context: Optional[str] = None,
) -> Dict:
    """
    Send a query to Groq with RAG context and conversation history.
    
    Args:
        query: The student's message
        student_info: Dict with student details
        conversation_history: Previous conversation turns
        use_rag: Whether to retrieve context from knowledge base
        provided_context: Pre-retrieved context (e.g. Testing Console JSON
            knowledge). When set, this is used INSTEAD of re-querying FAISS.
        
    Returns:
        Dict with answer, sources, chunk_ids, scores, and confidence
    """
    logger.info(f"=== STEP 9: LLM CALL ===")
    logger.info(f"Query: {query}")
    logger.info(f"Use RAG: {use_rag}")
    logger.info(f"Provided context: {bool(provided_context)}")
    
    retrieved_chunks = []
    
    try:
        # Use caller-provided context if supplied (JSON retriever, /insert,
        # or pre-retrieved FAISS chunks) — otherwise retrieve from FAISS.
        context = ""
        if provided_context:
            context = provided_context
            logger.info("Using caller-provided context (%d chars)", len(context))
        elif use_rag and is_knowledge_ready():
            logger.info("Retrieving context from knowledge base...")
            retrieved = await retrieve_context(query)
            retrieved_chunks = retrieved
            context = format_context_for_prompt(retrieved)
            logger.info(f"Retrieved {len(retrieved)} chunks for query")
            logger.info(f"Context length: {len(context)} characters")
        else:
            logger.warning("RAG disabled or knowledge base not ready")

        # Build prompt
        logger.info("Building prompt...")
        messages = build_prompt(query, context, student_info, conversation_history)
        logger.info(f"Prompt built with {len(messages)} messages")

        # Get Groq response (auto model-fallback on 429 rate limits)
        logger.info("Calling Groq API...")
        client = _get_client()
        
        import time
        start_time = time.time()
        
        response = await _create_with_fallback(
            messages,
            temperature=0.5,
            max_tokens=1024,
        )
        
        latency = time.time() - start_time
        logger.info(f"Groq API call completed in {latency:.2f} seconds")
        
        answer = response.choices[0].message.content.strip()
        logger.info(f"Response length: {len(answer)} characters")
        logger.info(f"Response preview (first 200 chars): {answer[:200]}...")
        
        # Verify response is not empty
        if not answer:
            logger.error("✗ Empty response from Groq")
            logger.error("STEP 9 FAILED: Empty LLM response")
            raise ValueError("Empty response from Groq")
        
        logger.info("✓ Non-empty response received")
        
        # Log token usage if available
        token_usage = None
        if hasattr(response, 'usage'):
            logger.info(f"Token usage: {response.usage}")
            token_usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }
        
        # Calculate confidence based on retrieval scores
        confidence = 0.0
        if retrieved_chunks:
            avg_score = sum(c.get("score", 0) for c in retrieved_chunks) / len(retrieved_chunks)
            confidence = min(max(avg_score, 0.0), 1.0)
            logger.info(f"Calculated confidence: {confidence:.4f}")
        
        logger.info(f"=== STEP 9 COMPLETE: LLM CALL SUCCESSFUL ===")
        
        # STEP 10: Return complete response with metadata
        logger.info(f"=== STEP 10: FINAL RESPONSE CONSTRUCTION ===")
        
        result = {
            "answer": answer,
            "sources": [c.get("source", "unknown") for c in retrieved_chunks],
            "chunk_ids": [c.get("chunk_id") for c in retrieved_chunks],
            "similarity_scores": [c.get("score", 0.0) for c in retrieved_chunks],
            "confidence": confidence,
            "retrieved_count": len(retrieved_chunks),
            "latency_seconds": latency,
            "token_usage": token_usage,
            "rag_enabled": use_rag
        }
        
        logger.info(f"✓ Final response constructed with {len(result)} fields")
        logger.info(f"Answer length: {len(answer)} characters")
        logger.info(f"Sources: {result['sources']}")
        logger.info(f"Chunk IDs: {result['chunk_ids']}")
        logger.info(f"Similarity scores: {[f'{s:.4f}' for s in result['similarity_scores']]}")
        logger.info(f"Confidence: {confidence:.4f}")
        logger.info(f"=== STEP 10 COMPLETE: FINAL RESPONSE SUCCESSFUL ===")
        
        return result

    except Exception as e:
        logger.error(f"✗ Groq chat failed: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error("STEP 9 FAILED: LLM call error")
        raise


async def generate_response(
    conversation_history: List[Dict],
    context: str,
    user_message: str,
) -> str:
    """
    Generate a response for a single message.

    The caller's context (JSON retriever, /insert, or pre-retrieved FAISS
    chunks) is passed straight to the LLM — it is never discarded and never
    re-retrieved, which keeps the Testing Console isolated from the uploaded
    knowledge base.

    Args:
        conversation_history: Previous conversation turns
        context: System context/prompt
        user_message: Current user message
        
    Returns:
        Response text only
    """
    result = await chat(
        query=user_message,
        student_info=None,
        conversation_history=conversation_history,
        use_rag=False,  # context is passed explicitly below
        provided_context=context or None,
    )
    return result.get("answer", "")


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
        client = _get_client()
        response = await client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )

        text = response.choices[0].message.content.strip()
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
