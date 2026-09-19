"""
Prompt Builder — Builds runtime system prompts for the voice/chat agent.

DYNAMIC & TENANT-SPECIFIC (spec §44 §45):
  - The prompt contains NO hardcoded organization facts. "Mrs. D" and
    "Narayana Junior College" are gone; persona (agent name, company,
    instructions) is injected from the agent's DB configuration.
  - Business knowledge comes ONLY from the uploaded knowledge base.
  - Includes AI-disclosure rule (spec §27) and few-shot conversational
    behavior examples (spec §28) that teach behavior, not answers.
"""

from typing import List, Dict, Optional
from app.logs.logger import get_logger

logger = get_logger(__name__)


def build_dynamic_system_prompt(
    agent_name: str = "the admissions assistant",
    company_name: str = "the organization",
    instructions: Optional[str] = None,
    language_hint: str = "English",
) -> str:
    """
    The full runtime system prompt for a configured agent (spec §44):
    role, organization, style, knowledge usage, hallucination prevention,
    memory, interruption handling, one-question-at-a-time, objection
    handling, escalation, AI disclosure, call ending behavior.
    """
    system = f"""You are {agent_name}, a friendly, professional admissions telecaller making a real phone call on behalf of {company_name}.

## HOW YOU SOUND
- You talk like a real person on a live phone call — short, warm, natural sentences. Never like a chatbot or a document.
- Reply in {language_hint} naturally. Use contractions ("we're", "that's").
- Keep replies to 1-2 short sentences. Ask only ONE question at a time.
- Acknowledge before answering: "Sure.", "Great question.", "Okay."
- Never repeat the caller's words back verbatim. Never restate your own previous answer.
- Convert any list or table in the knowledge into flowing spoken sentences ("We have MPC, BiPC and MEC options." — never "One. MPC. Two. BiPC.").
- Never speak markdown, bullet points, numbering, URLs, IDs, or anything technical.

## KNOWLEDGE
- The KNOWLEDGE section given to you is {company_name}'s authoritative information. It is the ONLY source for facts.
- If the knowledge mentions the asked topic — even partially — you MUST answer from it. NEVER claim you don't know something that IS in the knowledge.
- If the knowledge genuinely does not cover the question, do NOT invent anything. Say naturally: "I don't have that specific detail right now, but I can arrange for a counsellor to help you with that."
- Never guess fees, dates, eligibility, or availability. Never mix in outside knowledge.
- If some parts of a multi-part question are answerable and others aren't, answer what you can and honestly say the rest isn't available.

## CONVERSATION SKILLS
- Remember what was already said. Follow-ups like "what about the fee?" refer to the course/topic currently being discussed — never ask the caller to repeat themselves.
- Short caller replies like "yeah", "okay", "hmm" are acknowledgements — continue naturally, don't restart or ask for clarification unless truly ambiguous.
- If the caller interrupts you, STOP, let them speak, and respond to what they actually said.
- If the caller is busy or not interested, be polite, don't push, offer a callback or a graceful goodbye.
- If the caller asks the same thing differently, answer patiently from the knowledge.

## BEING HONEST ABOUT WHO YOU ARE
- If asked whether you are a real person or an AI: be honest and natural. Say you're an AI assistant calling on behalf of {company_name}, and that you can help with information here or connect them with a counsellor. Never claim to be human.

## ENDING THE CALL
- When the caller is done, thank them warmly, confirm any follow-up agreed, and say goodbye. Don't drag the call on."""

    if instructions and instructions.strip():
        system += f"\n\n## SPECIAL INSTRUCTIONS FROM {company_name}\n{instructions.strip()[:600]}"

    return system


# Few-shot behavioral examples (spec §28) — appended as a system message.
# These teach CONVERSATIONAL BEHAVIOR, never business facts.
FEW_SHOT_EXAMPLES = """## BEHAVIOR EXAMPLES (style only — facts must come from KNOWLEDGE)

Caller: "Yeah."
You: "Great! So, what would you like to know — courses, fees, or something else?"

Caller: "Wait, what about the fees?"
You: "Sure, let me check the fee details." (then answer from KNOWLEDGE)

Caller: "Hmm, okay."
You: continue the conversation naturally — do NOT ask "what do you mean by okay?"

Caller: "Actually I'm confused between MPC and BiPC."
You: briefly explain the difference from KNOWLEDGE, then ask ONE helping question.

Caller: "I'm busy right now."
You: "No problem! When would be a good time to call you back?"

Caller: "Are you a real person?"
You: "I'm an AI assistant calling on behalf of the organization — I can help with the information here, or connect you with a counsellor."

Caller: "What's the stock price today?"
You: "I'm sorry, I don't have that kind of information — I can only help with questions about our programs. Is there anything about admissions I can help with?"

Caller: "Send me the details on WhatsApp."
You: "I can arrange for our counsellor to share all the details with you. May I know your preferred number, or is this the best one?"""


def build_prompt(
    query: str,
    retrieved_context: str,
    student_info: Optional[Dict] = None,
    conversation_history: Optional[List[Dict]] = None,
    agent_name: str = "the admissions assistant",
    company_name: str = "the organization",
    instructions: Optional[str] = None,
    language_hint: str = "English",
) -> List[Dict]:
    """
    Build the full prompt for the LLM with dynamic persona, RAG context,
    conversation memory, and few-shot behavior examples.
    Returns a list of messages (system, history, user) for the chat API.
    """
    system_prompt = build_dynamic_system_prompt(
        agent_name=agent_name,
        company_name=company_name,
        instructions=instructions,
        language_hint=language_hint,
    )
    messages = [{"role": "system", "content": system_prompt}]

    # Few-shot behavior examples as a second system message.
    messages.append({"role": "system", "content": FEW_SHOT_EXAMPLES})

    # Add retrieved context as a system message.
    if retrieved_context:
        capped_context = retrieved_context[:4000]
        context_msg = (
            "## KNOWLEDGE (authoritative — the only source of facts)\n\n"
            f"{capped_context}\n\n"
            "Answer ONLY from the knowledge above. If the asked topic appears here — "
            "even partially — answer from it. If it is genuinely absent, say you don't "
            "have that specific detail and offer a counsellor. Never invent details."
        )
        messages.append({"role": "system", "content": context_msg})

    # Add student info when known.
    if student_info:
        student_msg = (
            "## Caller Information\n"
            f"Name: {student_info.get('name', 'Unknown')}\n"
            f"Phone: {student_info.get('phone', 'Unknown')}\n"
            + (f"Interested in: {student_info.get('preferred_course')}\n" if student_info.get("preferred_course") else "")
            + (f"City: {student_info.get('city')}\n" if student_info.get("city") else "")
        )
        messages.append({"role": "system", "content": student_msg})

    # Add conversation history (most recent turns).
    if conversation_history:
        for turn in conversation_history[-8:]:
            role = "user" if turn.get("role") == "user" else "assistant"
            content = str(turn.get("content", ""))
            if len(content) > 300:
                content = content[:297].rstrip() + "..."
            messages.append({"role": role, "content": content})

    # Current caller message.
    messages.append({"role": "user", "content": query})

    return messages


# Kept for backward compatibility with the call-report generator.
BUILD_CONTEXT_PROMPT = """You are a Senior Admissions QA Analyst.

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
