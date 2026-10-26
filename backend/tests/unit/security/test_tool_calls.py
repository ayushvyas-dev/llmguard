import pytest

from app.core.errors import GatewayError
from app.schemas.chat import ToolCall, ToolDefinition
from app.security.tool_calls import validate_calls, validate_definitions

SCHEMA = {
    "type": "object",
    "properties": {"city": {"type": "string", "minLength": 1}},
    "required": ["city"],
    "additionalProperties": False,
}


def definition(parameters=SCHEMA) -> ToolDefinition:
    return ToolDefinition(function={"name": "lookup_weather", "parameters": parameters})


def call(name="lookup_weather", arguments='{"city":"Delhi"}') -> ToolCall:
    return ToolCall(id="call_1", function={"name": name, "arguments": arguments})


def test_allowed_tool_and_matching_arguments_validate() -> None:
    definitions = validate_definitions([definition()], ["lookup_weather"], 16_384)
    validate_calls([call()], definitions, ["lookup_weather"], 8_192)


@pytest.mark.parametrize(
    "tools",
    [[definition()]],
)
def test_unapproved_definition_is_rejected(tools) -> None:
    with pytest.raises(GatewayError) as exc_info:
        validate_definitions(tools, [], 16_384)
    assert exc_info.value.code == "blocked_by_policy"


@pytest.mark.parametrize(
    "arguments",
    ["{bad json", '{"city":1}', '{"city":"Delhi","__proto__":{}}'],
)
def test_bad_or_forbidden_tool_arguments_are_rejected(arguments: str) -> None:
    definitions = validate_definitions([definition()], ["lookup_weather"], 16_384)
    with pytest.raises(GatewayError) as exc_info:
        validate_calls([call(arguments=arguments)], definitions, ["lookup_weather"], 8_192)
    assert exc_info.value.code == "output_blocked"


def test_unknown_call_name_is_rejected() -> None:
    definitions = validate_definitions([definition()], ["lookup_weather"], 16_384)
    with pytest.raises(GatewayError):
        validate_calls([call(name="unknown")], definitions, ["lookup_weather"], 8_192)


def test_tool_schema_size_and_unsafe_regex_are_rejected() -> None:
    with pytest.raises(GatewayError):
        validate_definitions([definition()], ["lookup_weather"], 8)
    unsafe = {"type": "object", "properties": {"x": {"type": "string", "pattern": "(a+)+$"}}}
    with pytest.raises(GatewayError):
        validate_definitions([definition(unsafe)], ["lookup_weather"], 16_384)
    remote_ref = {"type": "object", "$ref": "https://schemas.example.test/tool.json"}
    with pytest.raises(GatewayError):
        validate_definitions([definition(remote_ref)], ["lookup_weather"], 16_384)


def test_oversized_tool_arguments_are_rejected() -> None:
    definitions = validate_definitions([definition()], ["lookup_weather"], 16_384)
    with pytest.raises(GatewayError):
        validate_calls([call()], definitions, ["lookup_weather"], 4)
