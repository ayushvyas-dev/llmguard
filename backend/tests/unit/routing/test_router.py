"""Unit tests for GatewayRouter: retries, fallbacks, allowlists, breaker skip, and cancellation."""

import pytest

from app.core.errors import GatewayError
from app.providers.base import (
    ProviderAdapter,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCode,
    ProviderResponse,
)
from app.providers.catalog import ModelCatalog, ModelDefinition
from app.routing.breaker import CircuitBreaker
from app.routing.policy import RoutingPolicy
from app.routing.router import GatewayRouter
from app.schemas.chat import ChatCompletionRequest, ChatMessage


class FailingProviderAdapter(ProviderAdapter):
    name = "mock_prov"

    def __init__(
        self,
        failures_before_success: int = 0,
        error_code: ProviderErrorCode = ProviderErrorCode.UNAVAILABLE,
        supports_tools: bool = True,
        supports_streaming: bool = True,
    ) -> None:
        self.failures_before_success = failures_before_success
        self.error_code = error_code
        self._supports_tools = supports_tools
        self._supports_streaming = supports_streaming
        self.calls = 0

    async def complete(
        self, request: ChatCompletionRequest, provider_model: str
    ) -> ProviderResponse:
        self.calls += 1
        if self.calls <= self.failures_before_success:
            raise ProviderError(self.error_code, f"Simulated failure {self.calls}")
        return ProviderResponse(
            content="Mock response",
            finish_reason="stop",
            prompt_tokens=5,
            completion_tokens=5,
        )

    def capabilities(self, provider_model: str) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context=4096,
            supports_streaming=self._supports_streaming,
            supports_tools=self._supports_tools,
        )

    async def health_probe(self) -> bool:
        return True


@pytest.fixture
def test_setup():
    models = [
        ModelDefinition(
            alias="primary-model",
            provider="prov1",
            provider_model_id="m1",
            capabilities={"tools": True},
            enabled=True,
        ),
        ModelDefinition(
            alias="fallback-model",
            provider="prov2",
            provider_model_id="m2",
            capabilities={"tools": True},
            enabled=True,
        ),
        ModelDefinition(
            alias="no-tools-fallback",
            provider="prov3",
            provider_model_id="m3",
            capabilities={"tools": False},
            enabled=True,
        ),
    ]
    catalog = ModelCatalog(models)
    req = ChatCompletionRequest(
        model="primary-model",
        messages=[ChatMessage(role="user", content="Hello")],
    )
    return catalog, req


class TestGatewayRouterExecution:
    async def test_retry_count_never_exceeds_cap(self, test_setup) -> None:
        catalog, req = test_setup
        adapter = FailingProviderAdapter(
            failures_before_success=10, error_code=ProviderErrorCode.UNAVAILABLE
        )
        router = GatewayRouter(catalog, providers={"prov1": adapter})
        policy = RoutingPolicy(primary="primary-model", max_retries=2, backoff_base_seconds=0.01)

        with pytest.raises(GatewayError) as exc_info:
            await router.execute(req, policy)

        assert exc_info.value.status_code == 502
        assert adapter.calls == 3  # 1 initial + 2 retries
        assert len(exc_info.value.details["attempts"]) == 3

    async def test_non_retryable_error_never_retried(self, test_setup) -> None:
        catalog, req = test_setup
        adapter = FailingProviderAdapter(
            failures_before_success=10, error_code=ProviderErrorCode.AUTHENTICATION
        )
        router = GatewayRouter(catalog, providers={"prov1": adapter})
        policy = RoutingPolicy(
            primary="primary-model",
            fallbacks=["fallback-model"],
            max_retries=3,
        )

        with pytest.raises(GatewayError) as exc_info:
            await router.execute(req, policy)

        assert exc_info.value.code == "provider_authentication_failed"
        assert adapter.calls == 1  # Exactly 1 call; no retries, no fallback

    async def test_fallback_success_after_primary_failures(self, test_setup) -> None:
        catalog, req = test_setup
        primary_adapter = FailingProviderAdapter(
            failures_before_success=5, error_code=ProviderErrorCode.RATE_LIMITED
        )
        fallback_adapter = FailingProviderAdapter(failures_before_success=0)

        router = GatewayRouter(
            catalog,
            providers={"prov1": primary_adapter, "prov2": fallback_adapter},
        )
        policy = RoutingPolicy(
            primary="primary-model",
            fallbacks=["fallback-model"],
            max_retries=1,
            backoff_base_seconds=0.01,
        )

        result = await router.execute(req, policy)
        assert result.fallback_used is True
        assert result.model.alias == "fallback-model"
        assert result.response.content == "Mock response"
        assert primary_adapter.calls == 2  # 1 + 1 retry
        assert fallback_adapter.calls == 1  # Fallback succeeded
        assert len(result.attempts) == 3

    async def test_fallback_skipped_if_not_in_client_allowlist(self, test_setup) -> None:
        catalog, req = test_setup
        primary = FailingProviderAdapter(failures_before_success=5)
        fallback = FailingProviderAdapter(failures_before_success=0)

        router = GatewayRouter(catalog, providers={"prov1": primary, "prov2": fallback})
        policy = RoutingPolicy(
            primary="primary-model",
            fallbacks=["fallback-model"],
            max_retries=0,
        )

        # Client only allows primary-model
        with pytest.raises(GatewayError):
            await router.execute(req, policy, client_allowed_models=["primary-model"])

        assert primary.calls == 1
        assert fallback.calls == 0  # Fallback was skipped because not in allowlist

    async def test_fallback_skipped_if_lacks_capability(self, test_setup) -> None:
        catalog, _ = test_setup
        req_with_tools = ChatCompletionRequest(
            model="primary-model",
            messages=[ChatMessage(role="user", content="Hello")],
            tools=[{"type": "function", "function": {"name": "lookup"}}],
        )

        primary = FailingProviderAdapter(failures_before_success=5)
        no_tools_fallback = FailingProviderAdapter(failures_before_success=0, supports_tools=False)

        router = GatewayRouter(catalog, providers={"prov1": primary, "prov3": no_tools_fallback})
        policy = RoutingPolicy(
            primary="primary-model",
            fallbacks=["no-tools-fallback"],
            max_retries=0,
        )

        with pytest.raises(GatewayError):
            await router.execute(req_with_tools, policy)

        assert primary.calls == 1
        assert no_tools_fallback.calls == 0  # Lacks tools capability, so skipped

    async def test_both_providers_failing_reports_all_attempts(self, test_setup) -> None:
        catalog, req = test_setup
        primary = FailingProviderAdapter(
            failures_before_success=5, error_code=ProviderErrorCode.TIMEOUT
        )
        fallback = FailingProviderAdapter(
            failures_before_success=5, error_code=ProviderErrorCode.UNAVAILABLE
        )

        router = GatewayRouter(catalog, providers={"prov1": primary, "prov2": fallback})
        policy = RoutingPolicy(
            primary="primary-model",
            fallbacks=["fallback-model"],
            max_retries=1,
            backoff_base_seconds=0.01,
        )

        with pytest.raises(GatewayError) as exc_info:
            await router.execute(req, policy)

        attempts = exc_info.value.details["attempts"]
        assert len(attempts) == 4  # 2 for primary + 2 for fallback
        assert attempts[0]["provider"] == "prov1"
        assert attempts[2]["provider"] == "prov2"

    async def test_open_circuit_breaker_skips_provider(self, test_setup) -> None:
        catalog, req = test_setup
        primary = FailingProviderAdapter(failures_before_success=0)
        breaker = CircuitBreaker()
        # Pre-open the circuit for primary
        for _ in range(5):
            await breaker.record_failure("prov1", "m1")

        router = GatewayRouter(catalog, providers={"prov1": primary}, breaker=breaker)
        policy = RoutingPolicy(primary="primary-model", max_retries=0)

        with pytest.raises(GatewayError) as exc_info:
            await router.execute(req, policy)

        assert primary.calls == 0  # Was never called
        attempts = exc_info.value.details["attempts"]
        assert len(attempts) == 1
        assert attempts[0]["status"] == "circuit_open"

    async def test_client_disconnect_cancels_call(self, test_setup) -> None:
        catalog, req = test_setup
        primary = FailingProviderAdapter(failures_before_success=0)
        router = GatewayRouter(catalog, providers={"prov1": primary})
        policy = RoutingPolicy(primary="primary-model")

        with pytest.raises(GatewayError) as exc_info:
            await router.execute(req, policy, is_cancelled=lambda: True)

        assert exc_info.value.status_code == 499
        assert exc_info.value.code == "client_cancelled"
        assert primary.calls == 0
