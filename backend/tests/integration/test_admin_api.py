"""Integration tests for Admin API (clients, keys, policies, audit logging)."""

from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.core.config import Settings
from app.db.base import Base
from app.db.models import (
    ApiKey,
    AuditEvent,
    Client,
    ClientStatus,
    KeyRole,
    KeyStatus,
)
from app.main import create_app

TEST_PEPPER = "admin_integration_test_pepper_32_chars!!"


@pytest.fixture
async def admin_env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        api_key_pepper=TEST_PEPPER,
    )
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = session_factory

    # Seed an admin client + admin key
    admin_secret = f"admin_secret_{uuid4().hex}"
    admin_prefix = uuid4().hex[:8]
    admin_token = f"lga_dev_{admin_prefix}_{admin_secret}"

    # Seed a standard client + client key
    client_secret = f"client_secret_{uuid4().hex}"
    client_prefix = uuid4().hex[:8]
    client_token = f"lg_dev_{client_prefix}_{client_secret}"

    async with session_factory() as session:
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

        normal_client = Client(id=uuid4(), name="standard-tenant", status=ClientStatus.ACTIVE)
        session.add(normal_client)
        normal_key = ApiKey(
            id=uuid4(),
            client_id=normal_client.id,
            prefix=client_prefix,
            key_hash=hash_key(client_secret, TEST_PEPPER),
            role=KeyRole.CLIENT,
            status=KeyStatus.ACTIVE,
        )
        session.add(normal_key)

        await session.commit()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as http_client:
        yield {
            "http": http_client,
            "admin_token": admin_token,
            "client_token": client_token,
            "session_factory": session_factory,
            "normal_client_id": normal_client.id,
        }

    await engine.dispose()


class TestAdminAuthProtection:
    async def test_unauthenticated_returns_401(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        res = await client.get("/api/v1/admin/clients")
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "unauthorized"

    async def test_client_key_on_admin_endpoint_returns_403(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        client_token = admin_env["client_token"]
        res = await client.get(
            "/api/v1/admin/clients",
            headers={"Authorization": f"Bearer {client_token}"},
        )
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "forbidden"


class TestAdminClientCRUD:
    async def test_create_list_get_update_client(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        headers = {"Authorization": f"Bearer {admin_env['admin_token']}"}
        session_factory = admin_env["session_factory"]

        # 1. Create client
        payload = {
            "name": "acme-corp",
            "rate_limit_rpm": 60,
            "allowed_models": ["default-chat", "gemini-chat"],
        }
        res = await client.post("/api/v1/admin/clients", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "acme-corp"
        assert data["rate_limit_rpm"] == 60
        assert data["allowed_models"] == ["default-chat", "gemini-chat"]
        created_id = data["id"]

        # 2. Duplicate client name rejected with 409
        dup_res = await client.post("/api/v1/admin/clients", json=payload, headers=headers)
        assert dup_res.status_code == 409

        # 3. List clients
        list_res = await client.get("/api/v1/admin/clients", headers=headers)
        assert list_res.status_code == 200
        client_names = [c["name"] for c in list_res.json()]
        assert "acme-corp" in client_names

        # 4. Get client
        get_res = await client.get(f"/api/v1/admin/clients/{created_id}", headers=headers)
        assert get_res.status_code == 200
        assert get_res.json()["id"] == created_id

        # 5. Update client
        patch_res = await client.patch(
            f"/api/v1/admin/clients/{created_id}",
            json={"rate_limit_rpm": 120, "allowed_models": ["default-chat"]},
            headers=headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["rate_limit_rpm"] == 120
        assert patch_res.json()["allowed_models"] == ["default-chat"]

        # 6. Verify audit log entries were recorded
        async with session_factory() as session:
            events = (
                (
                    await session.execute(
                        select(AuditEvent).where(AuditEvent.target_id == str(created_id))
                    )
                )
                .scalars()
                .all()
            )
            actions = [e.action for e in events]
            assert "client.create" in actions
            assert "client.update" in actions


class TestAdminKeyManagement:
    async def test_create_and_revoke_key(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        headers = {"Authorization": f"Bearer {admin_env['admin_token']}"}
        normal_client_id = admin_env["normal_client_id"]
        session_factory = admin_env["session_factory"]

        # 1. Create a key
        create_res = await client.post(
            f"/api/v1/admin/clients/{normal_client_id}/keys",
            json={"role": "client", "expires_in_days": 10, "label": "API Key 1"},
            headers=headers,
        )
        assert create_res.status_code == 201
        data = create_res.json()
        assert "key" in data
        assert data["key"].startswith("lg_dev_")
        prefix = data["prefix"]
        raw_key = data["key"]

        # 2. List keys (should NOT contain the raw secret)
        list_res = await client.get(
            f"/api/v1/admin/clients/{normal_client_id}/keys",
            headers=headers,
        )
        assert list_res.status_code == 200
        keys = list_res.json()
        matching = [k for k in keys if k["prefix"] == prefix]
        assert len(matching) == 1
        assert "key" not in matching[0]

        # 3. Use the new key to call gateway endpoint
        gw_res = await client.post(
            "/api/v1/chat/completions",
            json={"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]},
            headers={"Authorization": f"Bearer {raw_key}"},
        )
        assert gw_res.status_code == 200

        # 4. Revoke the key
        revoke_res = await client.post(
            f"/api/v1/admin/keys/{prefix}/revoke",
            headers=headers,
        )
        assert revoke_res.status_code == 200
        assert revoke_res.json()["status"] == "revoked"

        # 5. Revoked key immediately fails on next request with 401
        gw_after_revoke = await client.post(
            "/api/v1/chat/completions",
            json={"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]},
            headers={"Authorization": f"Bearer {raw_key}"},
        )
        assert gw_after_revoke.status_code == 401

        # 6. Verify audit rows
        async with session_factory() as session:
            key_audits = (
                (await session.execute(select(AuditEvent).where(AuditEvent.target_id == prefix)))
                .scalars()
                .all()
            )
            actions = [a.action for a in key_audits]
            assert "key.create" in actions
            assert "key.revoke" in actions


class TestAdminPolicyManagement:
    async def test_policy_crud_and_versioning(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        headers = {"Authorization": f"Bearer {admin_env['admin_token']}"}
        session_factory = admin_env["session_factory"]

        det_cfg = {
            "enabled": True,
            "flag_threshold": 0.3,
            "redact_threshold": 0.5,
            "block_threshold": 0.8,
        }
        valid_config = {
            "version": 1,
            "mode": "enforce",
            "detectors": {
                "prompt_injection": det_cfg,
                "jailbreak": det_cfg,
                "pii": det_cfg,
                "secrets": det_cfg,
                "output": det_cfg,
            },
        }

        # 1. Create policy
        create_res = await client.post(
            "/api/v1/admin/policies",
            json={"name": "custom-strict", "config": valid_config, "is_default": False},
            headers=headers,
        )
        assert create_res.status_code == 201
        pol_data = create_res.json()
        assert pol_data["name"] == "custom-strict"
        assert pol_data["version"] == 1
        policy_id = pol_data["id"]

        # 2. Get policy
        get_res = await client.get(f"/api/v1/admin/policies/{policy_id}", headers=headers)
        assert get_res.status_code == 200
        assert get_res.json()["id"] == policy_id

        # 3. Update policy increments version
        updated_config = {**valid_config, "store_content": True}
        put_res = await client.put(
            f"/api/v1/admin/policies/{policy_id}",
            json={"config": updated_config},
            headers=headers,
        )
        assert put_res.status_code == 200
        assert put_res.json()["version"] == 2

        # 4. Invalid config rejected with 422
        bad_config = {**valid_config, "detectors": {"unknown_detector": {"enabled": True}}}
        bad_res = await client.put(
            f"/api/v1/admin/policies/{policy_id}",
            json={"config": bad_config},
            headers=headers,
        )
        assert bad_res.status_code == 422

        # 5. Verify audit rows
        async with session_factory() as session:
            events = (
                (
                    await session.execute(
                        select(AuditEvent).where(AuditEvent.target_id == str(policy_id))
                    )
                )
                .scalars()
                .all()
            )
            actions = [e.action for e in events]
            assert "policy.create" in actions
            assert "policy.update" in actions


class TestAdminRoutingPolicyCRUD:
    async def test_create_list_get_update_routing_policy(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        headers = {"Authorization": f"Bearer {admin_env['admin_token']}"}

        routing_cfg = {
            "primary": "openai:gpt-4o",
            "fallbacks": ["anthropic:claude-3-5-sonnet-20241022"],
            "allow_fallback": True,
            "per_attempt_timeout_seconds": 12.0,
            "request_deadline_seconds": 40.0,
            "max_retries": 3,
        }

        # 1. Create routing policy
        create_res = await client.post(
            "/api/v1/admin/policies/routing",
            json={"name": "standard-routing", "config": routing_cfg, "is_default": False},
            headers=headers,
        )
        assert create_res.status_code == 201
        data = create_res.json()
        assert data["name"] == "standard-routing"
        assert data["version"] == 1
        policy_id = data["id"]

        # 2. Get routing policy
        get_res = await client.get(f"/api/v1/admin/policies/routing/{policy_id}", headers=headers)
        assert get_res.status_code == 200
        assert get_res.json()["id"] == policy_id
        assert get_res.json()["config"]["primary"] == "openai:gpt-4o"

        # 3. List routing policies
        list_res = await client.get("/api/v1/admin/policies/routing", headers=headers)
        assert list_res.status_code == 200
        policy_ids = [p["id"] for p in list_res.json()]
        assert policy_id in policy_ids

        # 4. Update routing policy bumps version
        updated_cfg = {**routing_cfg, "max_retries": 4}
        put_res = await client.put(
            f"/api/v1/admin/policies/routing/{policy_id}",
            json={"config": updated_cfg},
            headers=headers,
        )
        assert put_res.status_code == 200
        assert put_res.json()["version"] == 2
        assert put_res.json()["config"]["max_retries"] == 4

        # 5. Invalid config (e.g. per_attempt_timeout_seconds <= 0) rejected
        bad_cfg = {**routing_cfg, "per_attempt_timeout_seconds": -5.0}
        bad_res = await client.put(
            f"/api/v1/admin/policies/routing/{policy_id}",
            json={"config": bad_cfg},
            headers=headers,
        )
        assert bad_res.status_code == 422


class TestAdminDemoMode:
    async def test_demo_mode_blocks_mutations(self, admin_env):
        client: httpx.AsyncClient = admin_env["http"]
        headers = {"Authorization": f"Bearer {admin_env['admin_token']}"}

        # Initially demo_mode is False
        mode_res = await client.get("/api/v1/admin/system/mode", headers=headers)
        assert mode_res.status_code == 200
        assert mode_res.json() == {"demo_mode": False}

        # Enable demo mode on app settings
        app = client._transport.app
        app.state.settings.demo_mode = True

        mode_res2 = await client.get("/api/v1/admin/system/mode", headers=headers)
        assert mode_res2.status_code == 200
        assert mode_res2.json() == {"demo_mode": True}

        # Read requests still succeed
        get_res = await client.get("/api/v1/admin/clients", headers=headers)
        assert get_res.status_code == 200

        # Mutation requests are blocked with 403 demo_mode_restricted
        post_res = await client.post(
            "/api/v1/admin/clients",
            json={"name": "demo-blocked-client"},
            headers=headers,
        )
        assert post_res.status_code == 403
        assert post_res.json()["error"]["code"] == "demo_mode_restricted"

        # Restore
        app.state.settings.demo_mode = False
