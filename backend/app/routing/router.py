"""Gateway routing orchestrator managing execution, timeouts, retries, jitter, and fallback."""

import asyncio
import random
import time
from collections.abc import Callable

import structlog

from app.core.errors import GatewayError
from app.providers.base import ProviderAdapter, ProviderError, ProviderErrorCode, ProviderResponse
from app.providers.catalog import ModelCatalog, ModelDefinition
from app.routing.breaker import CircuitBreaker
from app.routing.budget import DeadlineBudget, calculate_backoff_delay
from app.routing.decision import classify_error
from app.routing.metrics import ProviderHealthTracker
from app.routing.policy import RoutingPolicy
from app.schemas.chat import ChatCompletionRequest

logger = structlog.get_logger(__name__)


class RoutingResult:
    def __init__(
        self,
        response: ProviderResponse,
        model: ModelDefinition,
        attempts: list[dict],
        fallback_used: bool,
    ) -> None:
        self.response = response
        self.model = model
        self.attempts = attempts
        self.fallback_used = fallback_used


class GatewayRouter:
    """Coordinates provider calls, bounded retries, jittered backoff, and fallbacks."""

    def __init__(
        self,
        catalog: ModelCatalog,
        providers: dict[str, ProviderAdapter],
        breaker: CircuitBreaker | None = None,
        health_tracker: ProviderHealthTracker | None = None,
    ) -> None:
        self.catalog = catalog
        self.providers = providers
        self.breaker = breaker or CircuitBreaker()
        self.health_tracker = health_tracker or ProviderHealthTracker()

    async def execute(
        self,
        request: ChatCompletionRequest,
        policy: RoutingPolicy,
        client_allowed_models: list[str] | None = None,
        rng: random.Random | None = None,
        clock: Callable[[], float] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> RoutingResult:
        budget = DeadlineBudget(
            overall_deadline_seconds=policy.request_deadline_seconds,
            per_attempt_timeout_seconds=policy.per_attempt_timeout_seconds,
            clock=clock,
        )

        # 1. Build ordered candidate list [primary, *fallbacks]
        primary_alias = policy.primary or request.model
        candidates: list[str] = [primary_alias]

        allow_fallback = policy.allow_fallback and getattr(request.gateway, "allow_fallback", True)
        if allow_fallback and policy.fallbacks:
            for fb in policy.fallbacks:
                if fb not in candidates:
                    candidates.append(fb)

        attempts: list[dict] = []
        last_error_decision = None
        last_error_message = "All provider attempts failed."

        for candidate_alias in candidates:
            is_fallback = candidate_alias != primary_alias

            # A. Check client allowed models constraint
            if client_allowed_models and candidate_alias not in client_allowed_models:
                logger.info("candidate_skipped_allowlist", candidate=candidate_alias)
                continue

            # B. Resolve model definition from catalog
            try:
                candidate_provider = (
                    request.gateway.provider if candidate_alias == request.model else None
                )
                model_def = self.catalog.resolve(candidate_alias, provider=candidate_provider)
            except Exception:
                logger.warning("candidate_unresolvable", candidate=candidate_alias)
                continue

            # C. Check provider registration
            provider_adapter = self.providers.get(model_def.provider)
            if not provider_adapter:
                logger.warning("provider_unregistered", provider=model_def.provider)
                continue

            # D. Check capability constraints
            caps = provider_adapter.capabilities(model_def.provider_model_id)
            if request.stream and not caps.supports_streaming:
                logger.info("candidate_lacks_streaming", candidate=candidate_alias)
                continue
            if request.tools and not caps.supports_tools:
                logger.info("candidate_lacks_tools", candidate=candidate_alias)
                continue

            # E. Check circuit breaker state
            can_attempt = await self.breaker.can_attempt(
                model_def.provider, model_def.provider_model_id
            )
            if not can_attempt:
                attempts.append(
                    {
                        "provider": model_def.provider,
                        "model": model_def.provider_model_id,
                        "attempt": 0,
                        "status": "circuit_open",
                        "duration_ms": 0,
                    }
                )
                logger.warning(
                    "candidate_circuit_open_skipped",
                    provider=model_def.provider,
                    model=model_def.provider_model_id,
                )
                continue

            # F. Retry loop for this eligible candidate
            max_attempts = 1 + policy.max_retries
            for attempt_idx in range(max_attempts):
                # Check client cancellation
                if is_cancelled is not None:
                    cancelled = is_cancelled()
                    if asyncio.iscoroutine(cancelled):
                        cancelled = await cancelled
                    if cancelled:
                        raise GatewayError(
                            status_code=499,
                            code="client_cancelled",
                            message="Client disconnected during request.",
                            error_type="client_closed_request",
                            details={"attempts": attempts},
                        )

                # Check deadline budget
                if not budget.has_budget():
                    raise GatewayError(
                        status_code=504,
                        code="gateway_timeout",
                        message="Request exceeded overall deadline budget.",
                        error_type="timeout_error",
                        details={"attempts": attempts},
                    )

                attempt_timeout = budget.timeout_for_attempt()
                start_mono = time.perf_counter()

                try:
                    # Execute provider call with per-attempt timeout bounded by budget
                    provider_resp = await asyncio.wait_for(
                        provider_adapter.complete(request, model_def.provider_model_id),
                        timeout=attempt_timeout,
                    )
                    latency_ms = int((time.perf_counter() - start_mono) * 1000)

                    # Success: record breaker & health
                    await self.breaker.record_success(
                        model_def.provider, model_def.provider_model_id
                    )
                    await self.health_tracker.record(
                        model_def.provider,
                        model_def.provider_model_id,
                        latency_ms,
                        success=True,
                    )

                    attempts.append(
                        {
                            "provider": model_def.provider,
                            "model": model_def.provider_model_id,
                            "attempt": attempt_idx + 1,
                            "status": "success",
                            "duration_ms": latency_ms,
                        }
                    )

                    return RoutingResult(
                        response=provider_resp,
                        model=model_def,
                        attempts=attempts,
                        fallback_used=is_fallback,
                    )

                except TimeoutError:
                    latency_ms = int((time.perf_counter() - start_mono) * 1000)
                    exc = ProviderError(ProviderErrorCode.TIMEOUT, "Provider attempt timed out.")
                except ProviderError as e:
                    latency_ms = int((time.perf_counter() - start_mono) * 1000)
                    exc = e
                except Exception as e:
                    latency_ms = int((time.perf_counter() - start_mono) * 1000)
                    exc = ProviderError(ProviderErrorCode.UNAVAILABLE, f"Unexpected error: {e}")

                # Handle attempt failure
                decision = classify_error(exc)
                last_error_decision = decision
                last_error_message = exc.message

                await self.breaker.record_failure(model_def.provider, model_def.provider_model_id)
                await self.health_tracker.record(
                    model_def.provider,
                    model_def.provider_model_id,
                    latency_ms,
                    success=False,
                    error_code=exc.code.value if hasattr(exc, "code") else None,
                )

                attempts.append(
                    {
                        "provider": model_def.provider,
                        "model": model_def.provider_model_id,
                        "attempt": attempt_idx + 1,
                        "status": "error",
                        "error_code": exc.code.value if hasattr(exc, "code") else "error",
                        "duration_ms": latency_ms,
                    }
                )

                # If non-retryable error, stop retries on this candidate
                if not decision.retryable:
                    if not decision.fallback_eligible:
                        # Error cannot fallback (e.g. invalid request, auth failure)
                        raise GatewayError(
                            status_code=decision.status_code,
                            code=decision.error_code,
                            message=exc.message,
                            error_type=decision.error_type,
                            details={"attempts": attempts},
                        )
                    # Non-retryable but fallback-eligible: break to next candidate
                    break

                # If retryable and attempts remain
                if attempt_idx < policy.max_retries:
                    retry_after_val = getattr(exc, "retry_after", None)
                    delay = calculate_backoff_delay(
                        attempt=attempt_idx,
                        base_seconds=policy.backoff_base_seconds,
                        max_seconds=policy.backoff_max_seconds,
                        retry_after=retry_after_val,
                        retry_after_cap=policy.retry_after_cap_seconds,
                        rng=rng,
                    )
                    # Check if sleep fits in budget
                    if delay >= budget.remaining():
                        # Insufficient budget for backoff delay
                        break
                    await asyncio.sleep(delay)

        # All candidates and retries exhausted
        status_code = last_error_decision.status_code if last_error_decision else 502
        error_code = last_error_decision.error_code if last_error_decision else "provider_error"
        error_type = last_error_decision.error_type if last_error_decision else "provider_error"

        raise GatewayError(
            status_code=status_code,
            code=error_code,
            message=last_error_message,
            error_type=error_type,
            details={"attempts": attempts},
        )
