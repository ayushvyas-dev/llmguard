"""Eligibility rules for caching according to CACHE-001, CACHE-005, and CACHE-006."""

from app.schemas.chat import ChatCompletionRequest, ChatCompletionResponse
from app.security.models import DetectorResult, SecurityDecision
from app.security.policy import SecurityPolicy


def is_request_cache_eligible(
    request: ChatCompletionRequest,
    policy: SecurityPolicy,
    input_decision: SecurityDecision | None = None,
) -> tuple[bool, str | None]:
    """Check if an incoming request is eligible to read from or write to the cache.

    Returns (is_eligible, reason_code_if_ineligible).
    """
    if request.stream:
        return False, "streaming_not_supported"

    if request.tools and len(request.tools) > 0:
        return False, "tool_calls_ineligible"

    # Check client policy cacheable flag
    if not getattr(policy, "cacheable", True):
        return False, "policy_not_cacheable"

    # Check determinism: temperature == 0 by default, or opt-in cache: "force" if allowed
    temp = request.temperature
    is_force = request.gateway.cache == "force"
    if is_force and not getattr(policy, "allow_force_cache", True):
        return False, "force_cache_not_allowed_by_policy"

    is_deterministic = (temp == 0.0 or temp == 0) or is_force
    if not is_deterministic:
        return False, "non_deterministic_temperature"

    # Check sensitive data: do not cache if PII or secrets were flagged or redacted
    if input_decision is not None:
        if input_decision.action == "block":
            return False, "input_blocked"

        findings = getattr(input_decision, "findings", []) or []
        for finding in findings:
            if isinstance(finding, DetectorResult):
                category = finding.category
                action = finding.suggested_action
            elif isinstance(finding, dict):
                category = finding.get("category")
                action = finding.get("suggested_action")
            else:
                continue

            if category in ("pii", "secrets") and action in ("flag", "redact", "block"):
                return False, "sensitive_data_flagged"

    return True, None


def is_response_cache_eligible(
    response: ChatCompletionResponse,
    output_decision: SecurityDecision | None = None,
) -> tuple[bool, str | None]:
    """Check if the generated response is eligible to be written into the cache.

    Returns (is_eligible, reason_code_if_ineligible).
    """
    if output_decision is not None and output_decision.action == "block":
        return False, "output_blocked"

    # Do not cache responses that contain tool calls
    for choice in response.choices:
        msg = choice.message
        if msg.tool_calls and len(msg.tool_calls) > 0:
            return False, "response_has_tool_calls"

    return True, None
