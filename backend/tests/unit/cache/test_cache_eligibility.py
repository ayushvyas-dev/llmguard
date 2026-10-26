"""Unit tests for cache eligibility rules (CACHE-001, CACHE-005, CACHE-006)."""

from app.cache.eligibility import is_request_cache_eligible, is_response_cache_eligible
from app.schemas.chat import (
    AssistantMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    Choice,
    GatewayOptions,
    ToolCall,
    ToolCallFunction,
    ToolDefinition,
    ToolFunction,
)
from app.security.models import DetectorResult, SecurityDecision
from app.security.policy import DetectorPolicy, SecurityPolicy


def make_policy(**kwargs) -> SecurityPolicy:
    detectors = {
        "prompt_injection": DetectorPolicy(),
        "jailbreak": DetectorPolicy(),
        "pii": DetectorPolicy(),
        "secrets": DetectorPolicy(),
        "output": DetectorPolicy(),
    }
    return SecurityPolicy(detectors=detectors, **kwargs)


def test_standard_deterministic_request_is_eligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.0,
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy())
    assert eligible is True
    assert reason is None


def test_streaming_is_ineligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.0,
        stream=True,
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy())
    assert eligible is False
    assert reason == "streaming_not_supported"


def test_tool_calls_in_request_are_ineligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.0,
        tools=[
            ToolDefinition(
                type="function",
                function=ToolFunction(name="search", description="Search web"),
            )
        ],
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy())
    assert eligible is False
    assert reason == "tool_calls_ineligible"


def test_non_zero_temperature_without_opt_in_is_ineligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.7,
        gateway=GatewayOptions(cache="default"),
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy())
    assert eligible is False
    assert reason == "non_deterministic_temperature"


def test_non_zero_temperature_with_force_opt_in_is_eligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.7,
        gateway=GatewayOptions(cache="force"),
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy(allow_force_cache=True))
    assert eligible is True
    assert reason is None

    # If policy disables force cache, it remains ineligible
    disallow_policy = make_policy(allow_force_cache=False)
    eligible_disallowed, reason_disallowed = is_request_cache_eligible(req, policy=disallow_policy)
    assert eligible_disallowed is False
    assert reason_disallowed == "force_cache_not_allowed_by_policy"


def test_policy_cacheable_false_makes_request_ineligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="Hello")],
        temperature=0.0,
    )
    policy = make_policy(cacheable=False)
    eligible, reason = is_request_cache_eligible(req, policy=policy)
    assert eligible is False
    assert reason == "policy_not_cacheable"


def test_sensitive_data_flagged_makes_request_ineligible():
    req = ChatCompletionRequest(
        model="default-chat",
        messages=[ChatMessage(role="user", content="My email is alice@example.com")],
        temperature=0.0,
    )
    finding = DetectorResult(
        detector="pii_detector",
        category="pii",
        score=0.9,
        suggested_action="redact",
        reasons=["email_detected"],
        duration_ms=5.0,
    )
    sec_dec = SecurityDecision(
        action="redact",
        risk_score=0.9,
        findings=[finding],
        policy_version=1,
    )
    eligible, reason = is_request_cache_eligible(req, policy=make_policy(), input_decision=sec_dec)
    assert eligible is False
    assert reason == "sensitive_data_flagged"


def test_response_with_tool_calls_is_ineligible_for_storage():
    from app.schemas.chat import GatewayResponse, Usage

    resp = ChatCompletionResponse(
        id="resp-1",
        created=1000,
        model="default-chat",
        provider="fake",
        provider_model="fake-chat",
        choices=[
            Choice(
                message=AssistantMessage(
                    content=None,
                    tool_calls=[
                        ToolCall(
                            id="call_1",
                            function=ToolCallFunction(name="weather", arguments="{}"),
                        )
                    ],
                ),
                finish_reason="tool_calls",
            )
        ],
        usage=Usage(),
        gateway=GatewayResponse(request_id="r1", correlation_id="c1", latency_ms=5),
    )
    eligible, reason = is_response_cache_eligible(resp)
    assert eligible is False
    assert reason == "response_has_tool_calls"


def test_blocked_output_is_ineligible_for_storage():
    from app.schemas.chat import GatewayResponse, Usage

    resp = ChatCompletionResponse(
        id="resp-2",
        created=1000,
        model="default-chat",
        provider="fake",
        provider_model="fake-chat",
        choices=[Choice(message=AssistantMessage(content="Unsafe content"))],
        usage=Usage(),
        gateway=GatewayResponse(request_id="r2", correlation_id="c2", latency_ms=5),
    )
    out_dec = SecurityDecision(
        action="block",
        risk_score=0.95,
        findings=[],
        policy_version=1,
    )
    eligible, reason = is_response_cache_eligible(resp, output_decision=out_dec)
    assert eligible is False
    assert reason == "output_blocked"
