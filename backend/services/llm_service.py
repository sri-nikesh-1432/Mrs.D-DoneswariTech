"""
Groq LLM Service
Multilingual chat completions with automatic retry and streaming.
Injects a language/persona instruction so Shruthi always replies in the
caller's language with a warm, human admissions-counsellor style.
"""

import asyncio
from typing import List, Dict, AsyncGenerator
from groq import AsyncGroq, APIStatusError, APIConnectionError
from utils.config import settings
from utils.logger import get_logger
from services.prompt_service import get_system_prompt

logger = get_logger(__name__)

_client: AsyncGroq | None = None

# Human-readable language names for the prompt injection
_LANG_NAMES = {
    "en": "English",
    "te": "Telugu",
    "hi": "Hindi",
    "ta": "Tamil",
    "kn": "Kannada",
    "ml": "Malayalam",
}


def _get_client() -> AsyncGroq:
    global _client
    if _client is None:
        if not settings.GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set in .env")
        _client = AsyncGroq(api_key=settings.GROQ_API_KEY)
    return _client


def _build_messages(
    history: List[Dict[str, str]],
    user_message: str,
    lang: str = "en",
) -> List[Dict[str, str]]:
    """
    Build the full message list for the LLM.
    Appends a language + persona instruction to the system prompt so the model
    always replies in the detected language with a warm counsellor style.
    Technical terms (Python, API, etc.) stay in English naturally.
    """
    lang_name = _LANG_NAMES.get(lang, "English")
    lang_instruction = (
        f"\n\n## Language & Persona Instruction\n"
        f"You are a warm, professional Telugu-Indian FEMALE admissions counsellor — NOT a "
        f"translator and NOT a chatbot. Speak naturally, warmly and confidently, like a real "
        f"woman working in a Narayana admissions office on a live call.\n"
        f"\n"
        f"The user is communicating in **{lang_name}**. "
        f"You MUST reply entirely in {lang_name}. "
        f"Keep all technical terms (Python, Java, API, Machine Learning, B.Tech, MPC, BiPC, "
        f"JEE, NEET, fee, hostel, bus) in English even inside a regional-language reply.\n"
        f"If the user switches language mid-conversation, switch your reply language accordingly.\n"
        f"\n"
        f"CODE-MIXING: Indian callers naturally mix languages (e.g. 'Hostel fee entha?', "
        f"'MPC seats unnaya?'). When they mix, reply in the same natural blend — never force "
        f"fully-English or fully-Telugu.\n"
        f"\n"
        f"SPELLING (critical, never violate): write in the correct native script with PERFECT "
        f"spelling — never Romanized transliteration (write 'మీకు ఎలా సహాయం చేయగలను?', not "
        f"'meeku ela sahayam cheyagalanu?'). Telugu rules: exact vowel signs; compound verbs as "
        f"ONE word (చేయగలను, not 'చేయ గలను'); never swap similar consonants (డ/ద, ట/త, చ/స/శ); "
        f"reuse the caller's correctly spelled words; if unsure of a spelling, rephrase with a "
        f"simpler word rather than guessing.\n"
        f"\n"
        f"Fees & numbers: never write fees as bare digits alone. Write 'ఒక లక్ష రూపాయలు' for "
        f"₹100000, 'పదిహేను వేల రూపాయలు' for ₹15000.\n"
        f"\n"
        f"STYLE: Be human and conversational, like a caring counsellor. Occasionally use warm "
        f"natural fillers ('అవును...', 'ఖచ్చితంగా...', 'సరే...', 'తప్పకుండా...') but do not "
        f"overuse them. End most replies with a warm follow-up question."
    )
    system_content = get_system_prompt() + lang_instruction

    messages = [{"role": "system", "content": system_content}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})
    return messages


async def chat_completion(
    history: List[Dict[str, str]],
    user_message: str,
    lang: str = "en",
    max_retries: int = 3,
) -> str:
    """
    Full response chat completion with exponential-backoff retry.
    """
    messages = _build_messages(history, user_message, lang)
    client = _get_client()
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = await client.chat.completions.create(
                model=settings.GROQ_LLM_MODEL,
                messages=messages,
                temperature=0.5,
                max_tokens=2048,
                stream=False,
            )
            answer = response.choices[0].message.content.strip()
            logger.debug("LLM OK (attempt %d, lang=%s, %d chars)", attempt, lang, len(answer))
            return answer

        except APIConnectionError as e:
            last_error = e
            wait = 2 ** attempt
            logger.warning("Groq connection error (attempt %d/%d), retry in %ds", attempt, max_retries, wait)
            await asyncio.sleep(wait)

        except APIStatusError as e:
            if e.status_code == 429:
                wait = 2 ** attempt
                logger.warning("Groq rate limit (attempt %d/%d), retry in %ds", attempt, max_retries, wait)
                await asyncio.sleep(wait)
                last_error = e
            else:
                logger.error("Groq API error %d: %s", e.status_code, e.message)
                raise

    logger.error("All %d Groq retry attempts failed", max_retries)
    raise last_error


async def chat_completion_stream(
    history: List[Dict[str, str]],
    user_message: str,
    lang: str = "en",
) -> AsyncGenerator[str, None]:
    """
    Streaming chat completion — yields text chunks as they arrive.
    """
    messages = _build_messages(history, user_message, lang)
    client = _get_client()

    try:
        stream = await client.chat.completions.create(
            model=settings.GROQ_LLM_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=1024,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        logger.error("Streaming LLM error: %s", e)
        raise

