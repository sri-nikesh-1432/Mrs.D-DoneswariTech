"""
Prompt Builder — Builds prompts for Gemini with RAG context, conversation memory, and student info.
"""

from typing import List, Dict, Optional
from app.logs.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are Mrs. D, a Senior Admission Counselor representing the institute whose knowledge has been provided below.

## Your Role
- You are calling prospective students on behalf of the institute
- Your goal is to provide accurate information and encourage admission inquiries
- You represent ONLY the institute whose knowledge documents have been uploaded

## Your Personality
- Professional, warm, friendly, and confident
- Patient and persuasive without being aggressive
- Natural conversational tone — never robotic or scripted
- Build trust with students and parents

## Conversation Guidelines
1. **Use ONLY the retrieved context** to answer institute-specific questions
2. **Never invent or hallucinate** information about the institute
3. If information is not in the context, say: "I don't have the latest information regarding that. I recommend contacting the admissions office for confirmation."
4. **Promote the institute naturally** — highlight strengths, courses, facilities, placements, scholarships
5. **Handle objections** calmly — explain value, scholarships, and opportunities
6. **Keep responses concise** — 2-4 sentences for most replies
7. **Remember the student's name** and what they've said during the call
8. **End the conversation** by asking about interest and offering follow-up

## Call Stages
1. **Greeting**: "Hello! May I speak with [Student Name]?"
2. **Introduction**: "I'm Mrs. D calling on behalf of [Institute Name]. Is this a good time?"
3. **Promotion**: Briefly explain why the institute is a great choice
4. **Questions**: Answer student questions using retrieved context
5. **Objection Handling**: Address concerns naturally
6. **Interest Assessment**: Ask about their interest level
7. **Closing**: Thank them and offer follow-up

## Important Rules
- NEVER answer from general knowledge — use retrieved context only
- NEVER make up fees, dates, or statistics
- If you're unsure, be honest and recommend contacting admissions
- Keep the conversation natural and human-like
- Speak in the same language as the student
"""


def build_prompt(
    query: str,
    retrieved_context: str,
    student_info: Optional[Dict] = None,
    conversation_history: Optional[List[Dict]] = None,
) -> List[Dict]:
    """
    Build the full prompt for Gemini with context, history, and student info.
    
    Returns a list of messages (system, history, user) for Gemini.
    """
    logger.info(f"=== STEP 8: PROMPT CONSTRUCTION ===")
    logger.info(f"Query: {query}")
    logger.info(f"Retrieved context length: {len(retrieved_context)} characters")
    logger.info(f"Student info provided: {student_info is not None}")
    logger.info(f"Conversation history turns: {len(conversation_history) if conversation_history else 0}")
    
    # Groq uses the OpenAI-compatible chat format: string 'content', not Gemini-style 'parts'.
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    logger.info(f"✓ System prompt added (length: {len(SYSTEM_PROMPT)} characters)")

    # Add retrieved context as a system message
    if retrieved_context:
        context_msg = (
            "## Retrieved Institute Knowledge\n\n"
            f"{retrieved_context}\n\n"
            "IMPORTANT: Use ONLY the information above to answer questions. Do not use any external "
            "knowledge. If the answer is not in the retrieved context, say: 'I don't have confirmed "
            "information about that. Please contact the admissions office for details.'"
        )
        messages.append({"role": "system", "content": context_msg})
        logger.info(f"✓ Retrieved context added (length: {len(context_msg)} characters)")
        logger.info(f"Context preview (first 200 chars): {context_msg[:200]}...")
        logger.info("✓ Verified: Context will be passed to LLM")
    else:
        logger.warning("⚠ No retrieved context provided - LLM will answer without knowledge base")

    # Add student info
    if student_info:
        student_msg = (
            "## Student Information\n"
            f"Name: {student_info.get('name', 'Unknown')}\n"
            f"Phone: {student_info.get('phone', 'Unknown')}\n"
            f"Preferred Course: {student_info.get('preferred_course', 'Not specified')}\n"
            f"City: {student_info.get('city', 'Not specified')}\n"
        )
        messages.append({"role": "system", "content": student_msg})
        logger.info(f"✓ Student info added: {student_info.get('name', 'Unknown')}")

    # Add conversation history (legacy 'model' role is mapped to 'assistant')
    if conversation_history:
        for turn in conversation_history[-6:]:  # Last 6 turns for context
            role = "user" if turn.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": turn.get("content", "")})
        logger.info(f"✓ Conversation history added ({min(len(conversation_history), 6)} turns)")

    # Add the current query
    messages.append({"role": "user", "content": f"## Current Student Message\n\n{query}"})
    logger.info("✓ Current query added")

    # Log final prompt structure
    logger.info(f"Total messages in prompt: {len(messages)}")
    logger.info(f"Total prompt length: {sum(len(str(m.get('content', ''))) for m in messages)} characters")
    
    # Verify context is actually in the prompt
    context_in_prompt = any("Retrieved Institute Knowledge" in str(m.get('content', '')) for m in messages)
    if retrieved_context and not context_in_prompt:
        logger.error("✗ Retrieved context was not added to the prompt")
        logger.error("STEP 8 FAILED: Context not in prompt")
        raise ValueError("Retrieved context was not added to the prompt")
    
    if retrieved_context:
        logger.info("✓ Retrieved context is present in the prompt")
    
    logger.info(f"=== STEP 8 COMPLETE: PROMPT CONSTRUCTION SUCCESSFUL ===")
    return messages


BUILD_CONTEXT_PROMPT = """You are Mrs. D, a Senior Admission Counselor.

Based on the following conversation transcript, generate a structured call summary.

Conversation:
{transcript}

Generate a summary with:
1. Brief summary of the conversation (2-3 sentences)
2. Sentiment (positive/neutral/negative)
3. Interest score (0-100)
4. Admission probability (0.0-1.0)
5. Key questions asked by the student
6. Any objections raised
7. Recommended follow-up action
8. Overall notes

Format as JSON.
"""
