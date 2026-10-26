"""Canonical cache key construction according to CACHE-002."""

import hashlib
import json
import unicodedata
from uuid import UUID

from app.schemas.chat import ChatMessage, ToolDefinition

ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff", "\u2060"}


def normalize_cache_text(text: str) -> str:
    """Normalize text using NFKC, stripping zero-width and control characters."""
    cleaned = []
    for char in unicodedata.normalize("NFKC", text):
        if char in ZERO_WIDTH:
            continue
        if unicodedata.category(char) == "Cc" and char not in "\n\t":
            continue
        cleaned.append(char)
    return "".join(cleaned)


def canonical_json(data: object) -> str:
    """Produce deterministic JSON with sorted keys and no unnecessary whitespace."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_tools_hash(tools: list[ToolDefinition] | None) -> str | None:
    """Deterministic hash of tools schema definition, or None if no tools."""
    if not tools:
        return None
    serialized = [t.model_dump() for t in tools]
    return hashlib.sha256(canonical_json(serialized).encode("utf-8")).hexdigest()


def build_cache_key(
    client_id: UUID | str | None,
    policy_version: int,
    routing_version: int | str,
    provider: str,
    provider_model: str,
    messages: list[ChatMessage],
    generation_params: dict,
    tools: list[ToolDefinition] | None = None,
    cache_schema_version: int = 1,
) -> str:
    """Construct deterministic cache key prefixed with llmguard:cache:v1:."""
    normalized_messages = []
    for msg in messages:
        entry = {
            "role": msg.role,
            "content": normalize_cache_text(msg.content),
        }
        if msg.name is not None:
            entry["name"] = msg.name
        if msg.tool_call_id is not None:
            entry["tool_call_id"] = msg.tool_call_id
        normalized_messages.append(entry)

    # Standardize generation params (only relevant generation settings)
    standardized_params = {
        "temperature": generation_params.get("temperature"),
        "top_p": generation_params.get("top_p"),
        "max_tokens": generation_params.get("max_tokens"),
        "stop": generation_params.get("stop"),
        "seed": generation_params.get("seed"),
    }

    tools_hash = compute_tools_hash(tools)

    payload = {
        "client_id": str(client_id) if client_id is not None else "",
        "policy_version": int(policy_version),
        "routing_version": str(routing_version),
        "provider": str(provider),
        "provider_model": str(provider_model),
        "normalized_messages": normalized_messages,
        "generation_params": standardized_params,
        "tools_hash": tools_hash,
        "cache_schema_version": int(cache_schema_version),
    }

    canonical_str = canonical_json(payload)
    digest = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()
    return f"llmguard:cache:v1:{digest}"
