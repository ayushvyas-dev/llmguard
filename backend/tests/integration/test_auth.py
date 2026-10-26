"""Integration tests for authentication dependencies via HTTP endpoints."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.core.config import Settings
from app.db.base import Base
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus
from app.main import create_app

TEST_PEPPER = "integration_test_pepper_32_chars!!"


@pytest.fixture
async def app_and_session():
    """Create the app with an in-memory DB and yield (app, session_factory)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        api_key_pepper=TEST_PEPPER,
    )
    app = create_app(settings)
    # Replace the app's engine and session factory with our test ones
    app.state.engine = engine
    app.state.session_factory = session_factory

    yield app, session_factory

    await engine.dispose()


@pytest.fixture
async def client(app_and_session):
    app, _ = app_and_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as test_client:
        yield test_client


@pytest.fixture
async def session(app_and_session):
    _, session_factory = app_and_session
    async with session_factory() as session:
        yield session


async def _seed_client_key(
    session: AsyncSession,
    *,
    role: KeyRole = KeyRole.CLIENT,
    status: KeyStatus = KeyStatus.ACTIVE,
    client_status: ClientStatus = ClientStatus.ACTIVE,
    expires_at: datetime | None = None,
) -> str:
    """Insert a client + key and return the full bearer token."""
    secret = f"secret_{uuid4().hex}"
    prefix = uuid4().hex[:8]
    namespace = "lga" if role == KeyRole.ADMIN else "lg"

    db_client = Client(
        id=uuid4(),
        name=f"client-{uuid4().hex[:6]}",
        status=client_status,
    )
    session.add(db_client)
    key = ApiKey(
        id=uuid4(),
        client_id=db_client.id,
        prefix=prefix,
        key_hash=hash_key(secret, TEST_PEPPER),
        role=role,
        status=status,
        expires_at=expires_at,
    )
    session.add(key)
    await session.commit()
    return f"{namespace}_dev_{prefix}_{secret}"


CHAT_PAYLOAD = {
    "model": "default-chat",
    "messages": [{"role": "user", "content": "Hello"}],
}


class TestGatewayAuth:
    async def test_missing_auth_returns_401(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/v1/chat/completions", json=CHAT_PAYLOAD)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_malformed_bearer_returns_401(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": "Bearer tooshort"},
        )
        assert response.status_code == 401

    async def test_unknown_prefix_returns_401(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": "Bearer lg_dev_unknown1_somesecret_at_least_32"},
        )
        assert response.status_code == 401

    async def test_wrong_secret_returns_401(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session)
        # Replace the secret part
        parts = token.rsplit("_", 1)
        bad_token = f"{parts[0]}_wrongwrongwrongwrongwrongwrongwrong"
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {bad_token}"},
        )
        assert response.status_code == 401

    async def test_revoked_key_returns_401(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session, status=KeyStatus.REVOKED)
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    async def test_expired_key_returns_401(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        expired = datetime.now(UTC) - timedelta(hours=1)
        token = await _seed_client_key(session, expires_at=expired)
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401

    async def test_disabled_client_returns_403(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session, client_status=ClientStatus.DISABLED)
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "client_disabled"

    async def test_valid_client_key_returns_200(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session)
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        assert response.json()["provider"] == "fake"

    async def test_admin_key_rejected_on_gateway(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session, role=KeyRole.ADMIN)
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"


class TestRevocationTakesEffectImmediately:
    async def test_revoke_then_request_fails(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session)
        # First request succeeds
        r1 = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r1.status_code == 200

        # Revoke the key
        prefix = token.split("_", 3)[2]
        from sqlalchemy import update

        await session.execute(
            update(ApiKey)
            .where(ApiKey.prefix == prefix)
            .values(
                status=KeyStatus.REVOKED,
                revoked_at=datetime.now(UTC),
            )
        )
        await session.commit()

        # Next request fails
        r2 = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 401


class TestErrorMessagesAreGeneric:
    """Ensure error messages never leak whether a prefix exists or the secret was wrong."""

    async def test_unknown_prefix_message(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": "Bearer lg_dev_noexist1_somesecretvalue_extra"},
        )
        msg = response.json()["error"]["message"]
        assert "prefix" not in msg.lower()
        assert "secret" not in msg.lower()

    async def test_wrong_secret_message(
        self, client: httpx.AsyncClient, session: AsyncSession
    ) -> None:
        token = await _seed_client_key(session)
        parts = token.rsplit("_", 1)
        bad_token = f"{parts[0]}_wrongwrongwrongwrongwrongwrongwrong"
        response = await client.post(
            "/api/v1/chat/completions",
            json=CHAT_PAYLOAD,
            headers={"Authorization": f"Bearer {bad_token}"},
        )
        msg = response.json()["error"]["message"]
        assert "prefix" not in msg.lower()
        assert "secret" not in msg.lower()
