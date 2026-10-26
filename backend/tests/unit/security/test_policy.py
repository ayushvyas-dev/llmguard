import pytest
from pydantic import ValidationError

from app.schemas.chat import ChatCompletionRequest, ChatMessage
from app.security.engine import SecurityEngine
from app.security.models import DetectorResult
from app.security.policy import DetectorPolicy, PolicyResolver, SecurityPolicy, threshold_action


def test_policy_rejects_unordered_thresholds() -> None:
    with pytest.raises(ValidationError):
        DetectorPolicy(flag_threshold=0.6, redact_threshold=0.5)


def test_threshold_boundaries() -> None:
    config = DetectorPolicy(flag_threshold=0.2, redact_threshold=0.5, block_threshold=0.8)
    assert threshold_action(0.199999, config) == "allow"
    assert threshold_action(0.2, config) == "flag"
    assert threshold_action(0.499999, config) == "flag"
    assert threshold_action(0.5, config) == "redact"
    assert threshold_action(0.799999, config) == "redact"
    assert threshold_action(0.8, config) == "block"


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [("flag", "allow", "flag"), ("redact", "flag", "redact"), ("block", "redact", "block")],
)
def test_aggregation_precedence(left: str, right: str, expected: str) -> None:
    engine = SecurityEngine()
    policy = SecurityPolicy.default()
    policy.detectors["pii"] = DetectorPolicy(
        flag_threshold=0.3, redact_threshold=0.5, block_threshold=0.8
    )
    policy.detectors["prompt_injection"] = DetectorPolicy(
        flag_threshold=0.3, redact_threshold=0.5, block_threshold=0.8
    )
    scores = {"allow": 0.1, "flag": 0.4, "redact": 0.6, "block": 0.9}
    findings = [
        DetectorResult(
            detector="pii.rules",
            category="pii",
            score=scores[left],
            suggested_action=left,
            duration_ms=0,
        ),
        DetectorResult(
            detector="prompt_injection.rules",
            category="prompt_injection",
            score=scores[right],
            suggested_action=right,
            duration_ms=0,
        ),
    ]
    decision = engine._aggregate(findings, policy, [])
    assert decision.action == expected
    assert decision.risk_score == max(scores[left], scores[right])


def test_policy_resolver_accepts_valid_versioned_override() -> None:
    policy = SecurityPolicy.default().model_dump()
    policy["version"] = 7
    assert PolicyResolver().resolve(policy).version == 7


def test_policy_revision_increments_version() -> None:
    resolver = PolicyResolver()
    current = SecurityPolicy.default()
    revised = resolver.revise(current, current.model_dump())
    assert current.version == 1
    assert revised.version == 2


@pytest.mark.parametrize("pattern", ["(", "(a|aa)+$", r"\1", r"[a-z]{1,}"])
def test_policy_rejects_invalid_or_unbounded_custom_regex(pattern: str) -> None:
    config = SecurityPolicy.default().model_dump()
    config["custom_regex_entities"] = {"custom": pattern}
    with pytest.raises(ValidationError):
        SecurityPolicy.model_validate(config)


async def test_custom_regex_entities_are_applied() -> None:
    policy = SecurityPolicy.default().model_dump()
    policy["custom_regex_entities"] = {"employee_id": r"EMP-[0-9]{6}"}
    request = ChatCompletionRequest(
        model="default-chat", messages=[ChatMessage(role="user", content="Employee EMP-123456")]
    )
    cleaned, _ = await SecurityEngine().inspect_input(request, "req_custom", policy)
    assert cleaned.messages[0].content == "Employee [EMPLOYEE_ID_1]"
