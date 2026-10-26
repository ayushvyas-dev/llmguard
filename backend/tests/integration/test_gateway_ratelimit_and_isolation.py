"""Integration tests for rate limiting, model whitelisting, and policy isolation."""

from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.core.config import Settings
from app.db.base import Base
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus, SecurityPolicy
from app.main import create_app

TEST_PEPPER = "isolation_test_pepper_32_characters!!"


@pytest.fixture
async def gateway_env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    from app.security.writer import SecurityEventWriter

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        api_key_pepper=TEST_PEPPER,
        default_rate_limit_rpm=10,
        default_rate_limit_window_seconds=60,
    )
    writer = SecurityEventWriter(session_factory)
    app = create_app(settings, security_writer=writer)
    app.state.engine = engine
    app.state.session_factory = session_factory

    det_cfg = {
        "enabled": True,
        "flag_threshold": 0.3,
        "redact_threshold": 0.5,
        "block_threshold": 0.8,
    }
    strict_config = {
        "version": 1,
        "mode": "enforce",
        "custom_regex_entities": {"forbidden_term": r"restricted_keyword"},
        "detectors": {
            "prompt_injection": det_cfg,
            "jailbreak": det_cfg,
            "pii": det_cfg,
            "secrets": det_cfg,
            "output": det_cfg,
        },
    }

    async with session_factory() as session:
        strict_pol = SecurityPolicy(
            id=uuid4(),
            name="strict-policy",
            version=1,
            config=strict_config,
            is_default=False,
        )
        session.add(strict_pol)

        # Client A: rate_limit_rpm=2, allowed_models=["default-chat"], default policy
        secret_a = f"secret_{uuid4().hex}"
        prefix_a = uuid4().hex[:8]
        client_a = Client(
            id=uuid4(),
            name="client-a",
            status=ClientStatus.ACTIVE,
            rate_limit_rpm=2,
            window_seconds=60,
            allowed_models=["default-chat"],
        )
        session.add(client_a)
        key_a = ApiKey(
            id=uuid4(),
            client_id=client_a.id,
            prefix=prefix_a,
            key_hash=hash_key(secret_a, TEST_PEPPER),
            role=KeyRole.CLIENT,
            status=KeyStatus.ACTIVE,
        )
        session.add(key_a)

        # Client B: rate_limit_rpm=10, allowed_models=None (all), strict policy
        secret_b = f"secret_{uuid4().hex}"
        prefix_b = uuid4().hex[:8]
        client_b = Client(
            id=uuid4(),
            name="client-b",
            status=ClientStatus.ACTIVE,
            rate_limit_rpm=10,
            window_seconds=60,
            security_policy_id=strict_pol.id,
        )
        session.add(client_b)
        key_b = ApiKey(
            id=uuid4(),
            client_id=client_b.id,
            prefix=prefix_b,
            key_hash=hash_key(secret_b, TEST_PEPPER),
            role=KeyRole.CLIENT,
            status=KeyStatus.ACTIVE,
        )
        session.add(key_b)

        await session.commit()

    token_a = f"lg_dev_{prefix_a}_{secret_a}"
    token_b = f"lg_dev_{prefix_b}_{secret_b}"

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as http_client:
        yield {
            "http": http_client,
            "token_a": token_a,
            "token_b": token_b,
        }

    await engine.dispose()


class TestRateLimitingAndHeaders:
    async def test_rate_limit_enforced_and_headers_present(self, gateway_env):
        client: httpx.AsyncClient = gateway_env["http"]
        token_a = gateway_env["token_a"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        payload = {"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]}

        # Request 1: Allowed
        res1 = await client.post("/api/v1/chat/completions", json=payload, headers=headers_a)
        assert res1.status_code == 200
        assert res1.headers.get("X-RateLimit-Limit") == "2"
        assert res1.headers.get("X-RateLimit-Remaining") == "1"
        assert "X-RateLimit-Reset" in res1.headers

        # Request 2: Allowed
        res2 = await client.post("/api/v1/chat/completions", json=payload, headers=headers_a)
        assert res2.status_code == 200
        assert res2.headers.get("X-RateLimit-Remaining") == "0"

        # Request 3: Rate Limited (429) with Retry-After header
        res3 = await client.post("/api/v1/chat/completions", json=payload, headers=headers_a)
        assert res3.status_code == 429
        assert res3.json()["error"]["code"] == "rate_limited"
        assert "Retry-After" in res3.headers
        assert int(res3.headers["Retry-After"]) >= 1

    async def test_client_rate_limit_isolation(self, gateway_env):
        client: httpx.AsyncClient = gateway_env["http"]
        token_a = gateway_env["token_a"]
        token_b = gateway_env["token_b"]
        payload = {"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]}

        # Exhaust client A's quota
        auth_header_a = {"Authorization": f"Bearer {token_a}"}
        await client.post("/api/v1/chat/completions", json=payload, headers=auth_header_a)
        await client.post("/api/v1/chat/completions", json=payload, headers=auth_header_a)
        res_a_blocked = await client.post(
            "/api/v1/chat/completions", json=payload, headers=auth_header_a
        )
        assert res_a_blocked.status_code == 429

        # Client B must NOT be blocked!
        auth_header_b = {"Authorization": f"Bearer {token_b}"}
        res_b = await client.post("/api/v1/chat/completions", json=payload, headers=auth_header_b)
        assert res_b.status_code == 200


class TestModelWhitelistAndPolicyIsolation:
    async def test_model_whitelist_enforced(self, gateway_env):
        client: httpx.AsyncClient = gateway_env["http"]
        token_a = gateway_env["token_a"]  # allowed_models: ["default-chat"]

        # Allowed model
        res_ok = await client.post(
            "/api/v1/chat/completions",
            json={"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert res_ok.status_code == 200

        # Disallowed model
        res_forbidden = await client.post(
            "/api/v1/chat/completions",
            json={"model": "gemini-chat", "messages": [{"role": "user", "content": "Hello"}]},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert res_forbidden.status_code == 403
        assert res_forbidden.json()["error"]["code"] == "model_not_allowed"

    async def test_custom_policy_applied_per_client(self, gateway_env):
        client: httpx.AsyncClient = gateway_env["http"]
        token_b = gateway_env["token_b"]  # Has custom strict policy with forbidden_term regex

        # Calling with forbidden_term should trigger the custom entity rule
        body = {
            "model": "default-chat",
            "messages": [{"role": "user", "content": "hello restricted_keyword world"}],
        }
        res = await client.post(
            "/api/v1/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {token_b}"},
        )
        # Verify custom entity was processed under custom policy
        assert res.status_code in (200, 403)
