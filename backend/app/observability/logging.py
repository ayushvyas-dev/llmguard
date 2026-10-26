import re
from collections.abc import MutableMapping
from typing import Any

import structlog

SENSITIVE_KEYS = {"authorization", "api_key", "api-key", "x-api-key", "api_key_pepper"}
KEY_PATTERN = re.compile(r"\b(?:lg|lga)_[A-Za-z0-9_-]+\b")


def redact(_: Any, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key, value in list(event_dict.items()):
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = "[REDACTED]"
        elif isinstance(value, str):
            event_dict[key] = KEY_PATTERN.sub("[REDACTED]", value)
    return event_dict


def configure_logging() -> None:
    structlog.configure(
        processors=[
            redact,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ]
    )
