from uuid import uuid4

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.core.config import Settings
from app.db.base import Base
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus
from app.main import create_app

TEST_PEPPER = "chat_integration_test_pepper_32_chars!"


@pytest.fixture
async def app_setup():
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

    # Seed client and key
    secret = f"secret_{uuid4().hex}"
    prefix = uuid4().hex[:8]
    async with session_factory() as session:
        db_client = Client(id=uuid4(), name="chat-test-client", status=ClientStatus.ACTIVE)
        session.add(db_client)
        key = ApiKey(
            id=uuid4(),
            client_id=db_client.id,
            prefix=prefix,
            key_hash=hash_key(secret, TEST_PEPPER),
            role=KeyRole.CLIENT,
            status=KeyStatus.ACTIVE,
        )
        session.add(key)
        await session.commit()

    token = f"lg_dev_{prefix}_{secret}"

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as test_client:
        yield test_client

    await engine.dispose()


async def test_chat_completion_uses_fake_provider(app_setup: httpx.AsyncClient) -> None:
    response = await app_setup.post(
        "/api/v1/chat/completions",
        json={"model": "default-chat", "messages": [{"role": "user", "content": "Hello"}]},
    )
    assert response.status_code == 200
    assert response.json()["provider"] == "fake"
    assert response.json()["gateway"]["request_id"] == response.headers["x-request-id"]


@pytest.mark.parametrize(
    "payload",
    [
        {"model": "default-chat", "messages": []},
        {"model": "default-chat", "messages": [{"role": "invalid", "content": "x"}]},
        {"model": "default-chat", "messages": [{"role": "user", "content": "x"}], "temperature": 3},
        {"model": "default-chat", "messages": [{"role": "user", "content": "x"}], "unknown": True},
    ],
)
async def test_invalid_chat_requests_use_error_envelope(
    app_setup: httpx.AsyncClient, payload: dict
) -> None:
    response = await app_setup.post("/api/v1/chat/completions", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
