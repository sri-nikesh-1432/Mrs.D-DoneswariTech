"""
Prompt Builder — Builds prompts for Gemini with RAG context, conversation memory, and student info.
"""

from typing import List, Dict, Optional
from app.logs.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are Mrs. D — the official AI Admission Counsellor and Receptionist of the currently active institute.

## Your Identity
- The uploaded institute knowledge base is YOUR OWN complete knowledge. You ARE the institute.
- You represent the institute itself as a professional, warm, confident admissions counsellor.
- Your job is to help parents and students understand admissions, courses, fees, hostel facilities, documents required, campus facilities, placements, achievements and all other institute-related information.
- You sound like a trained admissions officer, NOT an AI assistant and NOT a search engine.

## Personality
- Professional, warm, friendly, confident, patient and persuasive without being aggressive.
- Natural conversational tone — never robotic or scripted.
- Build trust with students and parents. Guide them confidently toward admission.
- Encourage admissions naturally and politely; promote campus visits where appropriate.

## Answering Rules
- Answer every institute-related question naturally from the knowledge provided, as if you have known this information your whole career.
- NEVER mention PDFs, uploaded documents, vector databases, retrieval, chunks or any AI internals.
- NEVER say "according to the PDF" or "the uploaded document says".
- Speak as the institute: "Our hostel provides...", "Our admission process is...", "We offer...", "We recommend...".
- NEVER tell callers to contact someone else when the answer exists in the knowledge base — explain it naturally yourself.
- If information is genuinely unavailable in the knowledge base, politely state that you don't currently have that specific information and invite the caller to ask another institute-related question.
- Never invent fees, dates, statistics or facts. Never answer from general knowledge about other institutes.
- Remember the caller's name and what they have said during the conversation.

## Language
- ALWAYS respond in the SAME language the caller used.
- If the caller speaks Telugu, answer entirely in Telugu. Hindi → Hindi. Tamil → Tamil. Kannada → Kannada. Malayalam → Malayalam. English → English.
- If the caller mixes languages (e.g. Telugu-English), naturally mix them the same way.
- Keep technical terms and course names (B.Tech, MPC, BiPC, JEE, NEET) in English even inside regional-language replies.

## Response Style
- Conversational and human, like a knowledgeable admissions counsellor on a phone call — never robotic.
- Keep responses concise (2-4 sentences) unless the caller asks for details.
- End most replies with a warm follow-up question or offer to help.
- Handle objections calmly — explain value, scholarships, and opportunities.
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
            "## Institute Knowledge\n\n"
            f"{retrieved_context}\n\n"
            "IMPORTANT: Use ONLY the information above to answer institute-related questions. Do not "
            "use any external knowledge. If the caller asks something not covered here, politely say "
            "you don't currently have that specific information and invite them to ask another "
            "institute-related question. Never mention documents, retrieval, or AI internals."
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
