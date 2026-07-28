"""
Structured logging module with console and file output.
"""

import logging
import os
from datetime import datetime
from app.config import settings

os.makedirs(settings.LOGS_DIR, exist_ok=True)

_console = logging.StreamHandler()
_console.setFormatter(logging.Formatter(
    "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
))

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
