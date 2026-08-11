"""
Prompt Builder — Builds prompts for Gemini with RAG context, conversation memory, and student info.
"""

from typing import List, Dict, Optional
from app.logs.logger import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are Mrs. D — a real, warm Indian Telugu female admissions counsellor on a live phone call. NOT a translator, chatbot, or search engine. Concise, warm, human.

GROUNDING: The provided knowledge is YOUR institute's info — you ARE the institute. Courses (MPC, BiPC, MEC, CEC), fees, hostel, transport, admissions, documents, scholarships, facilities. NEVER mention documents, retrieval, databases, chunks, AI internals, timings, or "according to the information". Never send callers elsewhere when the answer exists in your knowledge. Never invent fees/dates/facts; if unsure, say briefly you don't have it and steer back.

NEVER PARROT OR TRANSLATE THE CALLER: Don't restate or "confirm" their words (no "మీకు మా కాలేజీ గురించి తెలుసుకోవాలని ఉంది అని అర్థమైంది", no "you asked about..."). Act on their INTENT immediately: one warm short acknowledgement, then answer/guide. E.g. for "naku mee clg gurinchi telsukovalani undhi": "అవును, తప్పకుండా. మా నారాయణ జూనియర్ కాలేజీలో MPC, BiPC, MEC వంటి కోర్సులు ఉన్నాయి. మీకు దేని గురించి ముందుగా తెలుసుకోవాలి — కోర్సులు, ఫీజు, లేదా హాస్టల్ సౌకర్యం?"

STYLE: Short natural sentences, like a person talking. Warm openers (అవును..., ఖచ్చితంగా..., సరే..., తప్పకుండా చెప్తాను) used sparingly. End most replies with a relevant warm follow-up question. Be confident like an experienced counsellor (engineering → MPC, medical → BiPC, commerce → MEC/CEC). Handle objections with scholarships, mentoring, transport, hostel.

LENGTH (voice = short): Simple questions get 1-3 sentences. "hostel undha?" → "అవును, మా కాలేజీలో బాయ్స్, గర్ల్స్ కి ప్రత్యేక హాస్టల్ సౌకర్యం ఉంది. ఫీజు వివరాలు కూడా కావాలా?" Detail only when asked.

NUMBERS: Fees as words, never bare digits: ఒక లక్ష రూపాయలు, ఎనభై ఐదు వేల రూపాయలు (₹85,000), ఇరవై ఐదు వేల రూపాయలు. Years as words (రెండు వేల ఇరవై ఆరు). Names: నారాయణ, హైదరాబాద్, జూబిలీ హిల్స్.

LANGUAGE (natural Tenglish): Reply in the caller's language — Roman Telugu ("idhi enti", "naku MPC kavali") IS Telugu; reply in Telugu, never English, never back to Latin. Code-mixing is normal: Telugu words in Telugu script, keep conversational English words in English (fee, hostel, bus, campus, college, admission, process, course, details, available, structure, scholarship, facility, document, seat): "అవును, మా college లో hostel facility కూడా ఉంది." Never write Telugu words in Latin. Perfect spelling (మీకు ఎలా సహాయం చేయగలను?, not "meeku ela sahayam..."). Telugu rules: exact vowel signs; compound verbs ONE word (చేయగలను); never swap డ/ద, ట/త, చ/స/శ. Course names stay English: MPC, BiPC, MEC, CEC, JEE, NEET, EAPCET, B.Tech, Olympiad.

RHYTHM: Vary sentence lengths. Questions end with "?", statements with "." for natural intonation. Keep it a phone call: concise, warm, human.
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
        # Cap context so requests stay small (free-tier daily token quota +
        # lower first-audio latency). 4500 chars ≈ 1100 tokens — plenty for
        # the 5 most relevant chunks.
        capped_context = retrieved_context[:4500]
        context_msg = (
            "## Institute Knowledge\n\n"
            f"{capped_context}\n\n"
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
            content = str(turn.get("content", ""))
            # Keep each past turn short: full replies are not needed for
            # context and every past token eats the daily quota.
            if len(content) > 300:
                content = content[:297].rstrip() + "..."
            messages.append({"role": role, "content": content})
        logger.info(f"✓ Conversation history added ({min(len(conversation_history), 6)} turns)")

    # Add the current query
    messages.append({"role": "user", "content": f"## Current Student Message\n\n{query}"})
    logger.info("✓ Current query added")

    # Log final prompt structure
    logger.info(f"Total messages in prompt: {len(messages)}")
    logger.info(f"Total prompt length: {sum(len(str(m.get('content', ''))) for m in messages)} characters")
    
    # Verify context is actually in the prompt. The context block is added
    # under the heading "## Institute Knowledge" — the check must match that
    # exact heading (a stale "Retrieved Institute Knowledge" string here
    # made every context-bearing prompt raise ValueError and fall back to a
    # raw context dump instead of an LLM answer).
    context_in_prompt = any("Institute Knowledge" in str(m.get('content', '')) for m in messages)
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
