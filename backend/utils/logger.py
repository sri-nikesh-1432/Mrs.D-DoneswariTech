import logging
import json
import os
from datetime import datetime
from utils.config import settings

os.makedirs(settings.LOGS_DIR, exist_ok=True)

# ── Console handler ──────────────────────────────────────────────────────────
_console = logging.StreamHandler()
_console.setFormatter(logging.Formatter(
    "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
))

# ── File handler (rotating daily) ────────────────────────────────────────────
_log_file = os.path.join(settings.LOGS_DIR, f"app_{datetime.now().strftime('%Y%m%d')}.log")
_file_handler = logging.FileHandler(_log_file, encoding="utf-8")
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
))


def get_logger(name: str) -> logging.Logger:
    """Return a configured logger for the given module name."""
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, settings.LOG_LEVEL, logging.INFO))
    if not logger.handlers:
        logger.addHandler(_console)
        logger.addHandler(_file_handler)
    logger.propagate = False
    return logger


# ── Conversation log (JSONL) ──────────────────────────────────────────────────
_conv_log_path = os.path.join(settings.LOGS_DIR, "conversations.jsonl")


def log_conversation(
    session_id: str,
    question: str,
    answer: str,
    duration_ms: float,
    input_type: str = "text",
) -> None:
    """Append a conversation turn to the JSONL conversation log."""
    entry = {
        "session_id": session_id,
        "timestamp": datetime.utcnow().isoformat(),
        "input_type": input_type,
        "question": question,
        "answer": answer,
        "duration_ms": round(duration_ms, 2),
    }
    with open(_conv_log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
