"""Error taxonomy and retry/fallback decision engine."""

from dataclasses import dataclass

from app.providers.base import ProviderError, ProviderErrorCode


@dataclass(frozen=True)
class RoutingDecision:
    retryable: bool
    fallback_eligible: bool
    status_code: int
    error_code: str
    error_type: str


_TAXONOMY: dict[ProviderErrorCode, RoutingDecision] = {
    ProviderErrorCode.RATE_LIMITED: RoutingDecision(
        retryable=True,
        fallback_eligible=True,
        status_code=429,
        error_code="provider_rate_limited",
        error_type="rate_limit_error",
    ),
    ProviderErrorCode.UNAVAILABLE: RoutingDecision(
        retryable=True,
        fallback_eligible=True,
        status_code=502,
        error_code="provider_unavailable",
        error_type="provider_error",
    ),
    ProviderErrorCode.TIMEOUT: RoutingDecision(
        retryable=True,
        fallback_eligible=True,
        status_code=504,
        error_code="gateway_timeout",
        error_type="timeout_error",
    ),
    ProviderErrorCode.AUTHENTICATION: RoutingDecision(
        retryable=False,
        fallback_eligible=False,
        status_code=502,
        error_code="provider_authentication_failed",
        error_type="provider_error",
    ),
    ProviderErrorCode.INVALID_REQUEST: RoutingDecision(
        retryable=False,
        fallback_eligible=False,
        status_code=400,
        error_code="provider_invalid_request",
        error_type="invalid_request_error",
    ),
    ProviderErrorCode.MISCONFIGURED: RoutingDecision(
        retryable=False,
        fallback_eligible=False,
        status_code=500,
        error_code="provider_misconfigured",
        error_type="server_error",
    ),
}


def classify_error(exc: Exception) -> RoutingDecision:
    """Classify an exception according to the error taxonomy."""
    if isinstance(exc, ProviderError):
        return _TAXONOMY.get(
            exc.code,
            RoutingDecision(
                retryable=False,
                fallback_eligible=False,
                status_code=502,
                error_code="provider_error",
                error_type="provider_error",
            ),
        )

    # Any other unexpected exception
    return RoutingDecision(
        retryable=False,
        fallback_eligible=False,
        status_code=500,
        error_code="internal_error",
        error_type="server_error",
    )
