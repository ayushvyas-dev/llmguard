import json
import re
from typing import Any

from jsonschema import Draft202012Validator, ValidationError

from app.core.errors import GatewayError
from app.schemas.chat import ToolCall, ToolDefinition

MAX_TOOLS = 16
DENIED_KEYS = {"__proto__", "prototype", "constructor", "$where"}
UNSAFE_PATTERN = re.compile(r"\([^)]*\)[+*{]|\\[1-9]")


def validate_definitions(
    tools: list[ToolDefinition] | None,
    allowed_tools: list[str],
    max_schema_bytes: int,
) -> dict[str, dict[str, Any]]:
    if not tools:
        return {}
    if len(tools) > MAX_TOOLS:
        raise GatewayError(
            403,
            "blocked_by_policy",
            "The request contains too many tool definitions.",
            "security_error",
        )
    definitions: dict[str, dict[str, Any]] = {}
    try:
        total_schema_bytes = sum(
            len(json.dumps(tool.function.parameters, separators=(",", ":")).encode())
            for tool in tools
        )
    except RecursionError as exc:
        raise GatewayError(422, "invalid_request", "A tool schema is too deeply nested.") from exc
    if total_schema_bytes > max_schema_bytes:
        raise GatewayError(
            403,
            "blocked_by_policy",
            "Tool schemas exceed the configured size limit.",
            "security_error",
        )
    for tool in tools:
        name = tool.function.name
        schema = tool.function.parameters
        if name not in allowed_tools or name in definitions:
            raise GatewayError(
                403, "blocked_by_policy", "A requested tool is not permitted.", "security_error"
            )
        try:
            Draft202012Validator.check_schema(schema)
        except (ValidationError, RecursionError) as exc:
            raise GatewayError(422, "invalid_request", "A tool schema is invalid.") from exc
        if schema.get("type") != "object":
            raise GatewayError(422, "invalid_request", "Tool parameters must use an object schema.")
        if _contains_remote_refs(schema):
            raise GatewayError(
                422, "invalid_request", "Remote schema references are not permitted."
            )
        if any(UNSAFE_PATTERN.search(pattern) for pattern in _schema_patterns(schema)):
            raise GatewayError(422, "invalid_request", "A tool schema contains an unsafe pattern.")
        definitions[name] = schema
    return definitions


def validate_calls(
    calls: tuple[ToolCall, ...] | list[ToolCall],
    definitions: dict[str, dict[str, Any]],
    allowed_tools: list[str],
    max_argument_bytes: int,
) -> None:
    if len(calls) > MAX_TOOLS:
        raise GatewayError(
            502,
            "output_blocked",
            "The provider returned too many tool calls.",
            "security_error",
        )
    for call in calls:
        name = call.function.name
        if name not in allowed_tools or name not in definitions:
            raise GatewayError(
                502,
                "output_blocked",
                "The provider returned an unauthorized tool call.",
                "security_error",
            )
        raw_arguments = call.function.arguments
        if len(raw_arguments.encode()) > max_argument_bytes:
            raise GatewayError(
                502,
                "output_blocked",
                "The provider returned oversized tool arguments.",
                "security_error",
            )
        try:
            arguments = json.loads(raw_arguments)
            if not isinstance(arguments, dict):
                raise ValueError("arguments must be an object")
            if _contains_denied_key(arguments):
                raise ValueError("arguments contain a denied key")
            Draft202012Validator(definitions[name]).validate(arguments)
        except (json.JSONDecodeError, ValueError, ValidationError, RecursionError) as exc:
            raise GatewayError(
                502,
                "output_blocked",
                "The provider returned invalid tool arguments.",
                "security_error",
            ) from exc


def _schema_patterns(value: Any):
    if isinstance(value, dict):
        if isinstance(value.get("pattern"), str):
            yield value["pattern"]
        yield from value.get("patternProperties", {})
        for child in value.values():
            yield from _schema_patterns(child)
    elif isinstance(value, list):
        for child in value:
            yield from _schema_patterns(child)


def _contains_denied_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            key in DENIED_KEYS or _contains_denied_key(child) for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_contains_denied_key(child) for child in value)
    return False


def _contains_remote_refs(value: Any) -> bool:
    if isinstance(value, dict):
        if {"$ref", "$dynamicRef", "$recursiveRef"} & value.keys():
            return True
        return any(_contains_remote_refs(child) for child in value.values())
    if isinstance(value, list):
        return any(_contains_remote_refs(child) for child in value)
    return False
