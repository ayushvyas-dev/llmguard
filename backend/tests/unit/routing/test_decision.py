"""Table tests for provider error taxonomy and routing decisions."""

import pytest

from app.providers.base import ProviderError, ProviderErrorCode
from app.routing.decision import classify_error


@pytest.mark.parametrize(
    (
        "error_code",
        "expected_retryable",
        "expected_fallback_eligible",
        "expected_status",
        "expected_error_code",
    ),
    [
        (ProviderErrorCode.RATE_LIMITED, True, True, 429, "provider_rate_limited"),
        (ProviderErrorCode.UNAVAILABLE, True, True, 502, "provider_unavailable"),
        (ProviderErrorCode.TIMEOUT, True, True, 504, "gateway_timeout"),
        (ProviderErrorCode.AUTHENTICATION, False, False, 502, "provider_authentication_failed"),
        (ProviderErrorCode.INVALID_REQUEST, False, False, 400, "provider_invalid_request"),
        (ProviderErrorCode.MISCONFIGURED, False, False, 500, "provider_misconfigured"),
    ],
)
def test_error_taxonomy_table(
    error_code: ProviderErrorCode,
    expected_retryable: bool,
    expected_fallback_eligible: bool,
    expected_status: int,
    expected_error_code: str,
) -> None:
    exc = ProviderError(error_code, "Simulated provider error")
    decision = classify_error(exc)

    assert decision.retryable == expected_retryable
    assert decision.fallback_eligible == expected_fallback_eligible
    assert decision.status_code == expected_status
    assert decision.error_code == expected_error_code


def test_unclassified_exception_defaults_to_non_retryable_500() -> None:
    exc = RuntimeError("unexpected crash")
    decision = classify_error(exc)
    assert decision.retryable is False
    assert decision.fallback_eligible is False
    assert decision.status_code == 500
    assert decision.error_code == "internal_error"
