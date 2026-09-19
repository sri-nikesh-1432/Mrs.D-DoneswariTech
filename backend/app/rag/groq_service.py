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
from app.rag.prompt_builder import build_prompt  # noqa: F401 (re-exported for legacy importers)
from app.rag.prompt_builder import build_dynamic_system_prompt, FEW_SHOT_EXAMPLES

# Legacy name kept importable: older modules import SYSTEM_PROMPT from here.
SYSTEM_PROMPT = build_dynamic_system_prompt()

logger = get_logger(__name__)

_client = None


def _model_chain() -> list:
    """Primary model first, then fallbacks (deduplicated)."""
    models = [settings.GROQ_MODEL] + list(settings.GROQ_FALLBACK_MODELS or [])
    seen = []
    for m in models:
        if m and m not in seen:
            seen.append(m)
    return seen or ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]


def _is_gpt_oss(model: str) -> bool:
    return "gpt-oss" in (model or "")


def _is_rate_limit(e: Exception) -> bool:
    """True for errors worth retrying on a different model — Groq 429 (per-model
    token cap), 404 (unknown model), or 400 model_decommissioned/not_found.
    Connection errors are retried on the same request; auth/validation errors
    must surface immediately."""
    status = getattr(e, "status_code", None)
    if status in (429, 404):
        return True
    name = type(e).__name__.lower()
    head = str(e)[:250].lower()
    if "ratelimit" in name or "429" in str(e)[:60] or "404" in str(e)[:60]:
        return True
    return (
        "model_not_found" in head
        or "model_decommissioned" in head
        or "decommissioned" in head
        or "does not exist" in head
        or "did not emit" in head
        or "emit any content" in head
        or "no content" in head
    )


async def _create_with_fallback(
    messages: List[Dict],
    temperature: float = 0.5,
    max_tokens: int = 1024,
    stream: bool = False,
    stop: Optional[List[str]] = None,
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
            kwargs = {}
            if _is_gpt_oss(model):
                # gpt-oss spends tokens on hidden reasoning before answering.
                # Low effort keeps TTFT fast and guarantees visible content
                # within the token budget (reasoning appears in a separate
                # field and is never spoken).
                kwargs["extra_body"] = {"reasoning_effort": "low"}
            return await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=stream,
                stop=stop,
                **kwargs,
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




async def stream_chat_fast(
    query: str,
    lang: str = "English",
    conversation_history: Optional[List[Dict]] = None,
    context: Optional[str] = None,
    agent_name: str = "Aadhya",
    company_name: str = "Doneswari",
    instructions: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    ULTRA-FAST streaming for <700ms voice turns.

    Optimisations vs the old version:
      - System prompt ≤ 120 tokens (was ~800) → less prefill → faster TTFT
      - Context hard-capped at 800 chars (4 RAG chunks ≈ 600-800 chars is enough)
      - Only last 3 history turns (was 4-6) → smaller prompt payload
      - max_tokens=180 for a concise 2-sentence phone answer (was 300)
      - temperature=0.25 → less sampling overhead
    """
    # ── System prompt (kept tiny for speed) ──────────────────────────────────
    system = (
        f"You are {agent_name}, a professional human-like telecaller from {company_name} on a live phone call. "
        f"Reply in {lang}. "
        f"Speak naturally and concisely in 1-2 sentences max. Ask only ONE question at a time. "
        f"CRITICAL for low latency: your FIRST sentence must be the direct answer in 12 words or fewer; "
        f"optionally add ONE short follow-up question as the second sentence. "
        f"Strict Anti-Hallucination: The KNOWLEDGE section below is authoritative and contains the institute's real details. "
        f"If the knowledge mentions the asked topic — even partially — you MUST answer from it. Never claim information is missing when it is present. "
        f"Never guess or invent fees, dates, or eligibility. "
        f"Only if the knowledge truly lacks the topic, say 'I don't have the exact information available right now. I can help with what I have, or arrange for a counsellor to provide the exact details.'"
    )
    if instructions and instructions.strip():
        system += f"\nSpecial Instructions: {instructions.strip()[:200]}"

    if context and context.strip():
        # Hard cap at 500 chars — keeps LLM prefill fast (TTFT) while still
        # covering the top RAG facts for grounded answers
        system += f"\n\nKNOWLEDGE:\n{context.strip()[:500]}"

    # ── Message list: system + last 3 turns + user ───────────────────────────
    messages: List[Dict] = [{"role": "system", "content": system}]

    if conversation_history:
        for turn in conversation_history[-4:]:          # last 2 exchanges (4 msgs)
            role = "user" if turn.get("role") == "user" else "assistant"
            content = str(turn.get("content", ""))[:100]  # hard truncate per turn
            if content.strip():
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": query})

    try:
        # max_tokens=180 → 1-2 crisp sentences; low temperature → consistent
        # grounding behaviour (never randomly refuses answerable questions)
        stream = await _create_with_fallback(
            messages, temperature=0.15, max_tokens=180, stream=True
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        logger.error("stream_chat_fast failed: %s", e)
        raise

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
        stream = await _create_with_fallback(messages, max_tokens=256, stream=True)
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
    agent_id: Optional[int] = None,
    agent_name: Optional[str] = None,
    company_name: Optional[str] = None,
    agent_instructions: Optional[str] = None,
    language_hint: Optional[str] = None,
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
        agent_id: Agent whose isolated knowledge store to search (spec §9).
        agent_name/company_name/agent_instructions/language_hint: dynamic
            persona (spec §44 §45) — never hardcoded organization facts.

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
        # or pre-retrieved FAISS chunks) — otherwise retrieve from the
        # AGENT-SCOPED store (spec §9: never a global unrestricted search).
        context = ""
        if provided_context:
            context = provided_context
            logger.info("Using caller-provided context (%d chars)", len(context))
        elif use_rag and (agent_id is None or is_knowledge_ready(agent_id)):
            logger.info("Retrieving context from knowledge base...")
            retrieved = await retrieve_context(
                query,
                conversation_history=conversation_history,
                agent_id=agent_id,
            )
            retrieved_chunks = retrieved
            context = format_context_for_prompt(retrieved)
            logger.info(f"Retrieved {len(retrieved)} chunks for query")
            logger.info(f"Context length: {len(context)} characters")
        else:
            logger.warning("RAG disabled or knowledge base not ready")

        # Build prompt (dynamic persona — agent params, spec §44)
        logger.info("Building prompt...")
        messages = build_prompt(
            query,
            context,
            student_info,
            conversation_history,
            agent_name=agent_name or "the admissions assistant",
            company_name=company_name or "the organization",
            instructions=agent_instructions,
            language_hint=language_hint or "English",
        )
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
