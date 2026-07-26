import os
from utils.config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

_cached_prompt: str | None = None


def get_system_prompt() -> str:
    """
    Load the system prompt from disk.
    Cached after first load — call reload_prompt() to refresh at runtime.
    """
    global _cached_prompt
    if _cached_prompt is not None:
        return _cached_prompt

    prompt_path = os.path.join(settings.PROMPTS_DIR, "system_prompt.txt")
    try:
        with open(prompt_path, "r", encoding="utf-8") as f:
            _cached_prompt = f.read().strip()
        logger.info("System prompt loaded (%d chars)", len(_cached_prompt))
    except FileNotFoundError:
        logger.error("system_prompt.txt not found at %s", prompt_path)
        _cached_prompt = (
            "You are Shruthi, a professional female educational counselor. "
            "Help students with all education-related queries warmly and naturally."
        )
    return _cached_prompt


def reload_prompt() -> str:
    """Force reload the system prompt from disk."""
    global _cached_prompt
    _cached_prompt = None
    return get_system_prompt()
