"""Integration tests for gateway routing, retries, fallback, and provider health."""

from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.core.config import Settings
from app.db.base import Base
from app.db.models import (
    ApiKey,
    Client,
    ClientStatus,
    KeyRole,
    KeyStatus,
)
from app.db.models import (
    RoutingPolicy as DbRoutingPolicy,
)
from app.main import create_app
from app.providers.base import (
    ProviderAdapter,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCode,
    ProviderResponse,
)
from app.providers.catalog import ModelCatalog, ModelDefinition
from app.routing.breaker import CircuitBreaker
from app.routing.router import GatewayRouter

TEST_PEPPER = "routing_integration_test_pepper_32_chars!"


class MockAdapter(ProviderAdapter):
    def __init__(self, name: str, behavior=None) -> None:
        self.name = name
        self.behavior = behavior or []
        self.calls = []

    def capabilities(self, model: str) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context=8192,
            supports_streaming=True,
            supports_tools=True,
            supported_parameters=frozenset({"temperature", "max_tokens", "top_p"}),
        )

    async def health_probe(self) -> bool:
        return True

    async def complete(self, request, model: str) -> ProviderResponse:
        self.calls.append((request, model))
        if self.behavior:
            action = self.behavior.pop(0)
            if isinstance(action, Exception):
                raise action
            return action
        return ProviderResponse(
            content=f"Response from {self.name}",
            prompt_tokens=10,
            completion_tokens=5,
            finish_reason="stop",
        )


@pytest.fixture
async def gateway_routing_env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        api_key_pepper=TEST_PEPPER,
        circuit_breaker_failure_threshold=2,
        circuit_breaker_recovery_seconds=30.0,
        max_retries=1,
        backoff_base_seconds=0.01,
        backoff_max_seconds=0.05,
    )

    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = session_factory

    # Create mock adapters
    primary_adapter = MockAdapter("primary-adapter")
    secondary_adapter = MockAdapter("secondary-adapter")

    custom_registry = {
        "primary_prov": primary_adapter,
        "secondary_prov": secondary_adapter,
    }
    custom_catalog = ModelCatalog(
        [
            ModelDefinition(
                alias="default-chat",
                provider="primary_prov",
                provider_model_id="primary-model-v1",
                capabilities={"streaming": True, "tools": True},
                enabled=True,
            ),
            ModelDefinition(
                alias="fallback-chat",
                provider="secondary_prov",
                provider_model_id="secondary-model-v1",
                capabilities={"streaming": True, "tools": True},
                enabled=True,
            ),
        ]
    )

    breaker = CircuitBreaker(
        failure_threshold=settings.circuit_breaker_failure_threshold,
        recovery_seconds=settings.circuit_breaker_recovery_seconds,
    )
    router = GatewayRouter(
        catalog=custom_catalog,
        providers=custom_registry,
        breaker=breaker,
    )
    app.state.orchestrator.catalog = custom_catalog
    app.state.orchestrator.providers = custom_registry
    app.state.orchestrator.router = router

    # Seed client and key
    secret = f"secret_{uuid4().hex}"
    prefix = uuid4().hex[:8]
    token = f"lg_dev_{prefix}_{secret}"

    admin_secret = f"admin_{uuid4().hex}"
    admin_prefix = uuid4().hex[:8]
    admin_token = f"lga_dev_{admin_prefix}_{admin_secret}"

    async with session_factory() as session:
        db_policy = DbRoutingPolicy(
            id=uuid4(),
            name="test-routing-policy",
            version=1,
            config={
                "primary": "default-chat",
                "fallbacks": ["fallback-chat"],
                "allow_fallback": True,
            },
        )
        session.add(db_policy)

        client = Client(
            id=uuid4(),
            name="routing-test-client",
            status=ClientStatus.ACTIVE,
            routing_policy_id=db_policy.id,
        )
        session.add(client)
        key = ApiKey(
            id=uuid4(),
            client_id=client.id,
            prefix=prefix,
            key_hash=hash_key(secret, TEST_PEPPER),
            role=KeyRole.CLIENT,
            status=KeyStatus.ACTIVE,
        )
        session.add(key)

        admin_client = Client(id=uuid4(), name="admin-tenant", status=ClientStatus.ACTIVE)
        session.add(admin_client)
        admin_key = ApiKey(
            id=uuid4(),
            client_id=admin_client.id,
            prefix=admin_prefix,
            key_hash=hash_key(admin_secret, TEST_PEPPER),
            role=KeyRole.ADMIN,
            status=KeyStatus.ACTIVE,
        )
        session.add(admin_key)
        await session.commit()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client_http:
        yield {
            "http": client_http,
            "token": token,
            "admin_token": admin_token,
            "primary": primary_adapter,
            "secondary": secondary_adapter,
            "breaker": breaker,
            "app": app,
        }

    await engine.dispose()


async def test_successful_primary_attempt(gateway_routing_env) -> None:
    http = gateway_routing_env["http"]
    token = gateway_routing_env["token"]

    response = await http.post(
        "/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "default-chat", "messages": [{"role": "user", "content": "Hi"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "primary_prov"
    assert data["choices"][0]["message"]["content"] == "Response from primary-adapter"
    assert data["gateway"]["fallback_used"] is False
    assert len(data["gateway"]["attempts"]) == 1
    assert data["gateway"]["attempts"][0]["provider"] == "primary_prov"
    assert data["gateway"]["attempts"][0]["status"] == "success"


async def test_fallback_when_primary_fails_transiently(gateway_routing_env) -> None:
    http = gateway_routing_env["http"]
    token = gateway_routing_env["token"]
    primary = gateway_routing_env["primary"]

    # Configure primary adapter to fail with 503 unavailable
    err = ProviderError(
        code=ProviderErrorCode.UNAVAILABLE,
        message="Primary overloaded",
    )
    # 2 failures: initial try + 1 retry on primary
    primary.behavior = [err, err]

    response = await http.post(
        "/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "default-chat", "messages": [{"role": "user", "content": "Hi"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "secondary_prov"
    assert data["choices"][0]["message"]["content"] == "Response from secondary-adapter"
    assert data["gateway"]["fallback_used"] is True
    # 2 attempts on primary + 1 attempt on fallback = 3 attempts total
    assert len(data["gateway"]["attempts"]) == 3
    assert data["gateway"]["attempts"][0]["provider"] == "primary_prov"
    assert data["gateway"]["attempts"][0]["status"] == "error"
    assert data["gateway"]["attempts"][1]["provider"] == "primary_prov"
    assert data["gateway"]["attempts"][1]["status"] == "error"
    assert data["gateway"]["attempts"][2]["provider"] == "secondary_prov"
    assert data["gateway"]["attempts"][2]["status"] == "success"


async def test_circuit_breaker_skips_open_provider(gateway_routing_env) -> None:
    http = gateway_routing_env["http"]
    token = gateway_routing_env["token"]
    admin_token = gateway_routing_env["admin_token"]
    breaker = gateway_routing_env["breaker"]

    # Trip the circuit breaker for primary
    await breaker.record_failure("primary_prov", "primary-model-v1")
    await breaker.record_failure("primary_prov", "primary-model-v1")

    # Primary circuit is now open, so it should be skipped without calling the primary adapter
    primary = gateway_routing_env["primary"]
    primary.calls.clear()

    response = await http.post(
        "/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "default-chat", "messages": [{"role": "user", "content": "Hi"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "secondary_prov"
    assert data["gateway"]["fallback_used"] is True
    assert len(primary.calls) == 0  # Not called because circuit is open!

    # Verify admin health endpoint reports circuit state as open
    health_resp = await http.get(
        "/api/v1/admin/providers/health",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert health_resp.status_code == 200
    health_data = health_resp.json()
    assert health_data["primary_prov"]["primary-model-v1"]["circuit_state"] == "open"


async def test_admin_health_requires_admin_role(gateway_routing_env) -> None:
    http = gateway_routing_env["http"]
    client_token = gateway_routing_env["token"]

    response = await http.get(
        "/api/v1/admin/providers/health",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert response.status_code == 403


async def test_non_retryable_error_does_not_fallback(gateway_routing_env) -> None:
    http = gateway_routing_env["http"]
    token = gateway_routing_env["token"]
    primary = gateway_routing_env["primary"]

    # 400 Invalid Request is non-retryable and fallback ineligible
    primary.behavior = [
        ProviderError(
            code=ProviderErrorCode.INVALID_REQUEST,
            message="Prompt contains invalid unicode",
        )
    ]

    response = await http.post(
        "/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "default-chat", "messages": [{"role": "user", "content": "Hi"}]},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["error"]["code"] == "provider_invalid_request"
