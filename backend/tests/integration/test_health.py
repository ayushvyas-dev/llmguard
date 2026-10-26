import httpx
import pytest
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
async def client():
    app = create_app(
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            database_url_direct="sqlite+aiosqlite:///:memory:",
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as test_client:
        yield test_client
    await app.state.engine.dispose()


async def test_health_is_live_and_has_request_id(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers["x-request-id"].startswith("req_")


async def test_not_found_uses_standard_error_envelope(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


async def test_validation_error_uses_standard_error_envelope(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/health", params={"probe": "not-an-integer"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


async def test_correlation_id_is_echoed_and_invalid_value_is_replaced(
    client: httpx.AsyncClient,
) -> None:
    valid = await client.get("/api/v1/health", headers={"X-Correlation-ID": "order-7731"})
    invalid = await client.get("/api/v1/health", headers={"X-Correlation-ID": "bad value"})
    assert valid.headers["x-correlation-id"] == "order-7731"
    assert invalid.headers["x-correlation-id"] == invalid.headers["x-request-id"]


async def test_oversized_body_is_rejected() -> None:
    app = create_app(
        Settings(database_url="sqlite+aiosqlite:///:memory:", request_max_body_bytes=4)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/api/v1/health", content=b"12345")
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    await app.state.engine.dispose()


async def test_readiness_returns_503_when_database_is_down(
    client: httpx.AsyncClient, monkeypatch
) -> None:
    class BrokenEngine:
        def connect(self):
            raise OperationalError("SELECT 1", {}, Exception("down"))

    monkeypatch.setattr(client._transport.app.state, "engine", BrokenEngine())
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["database"] == "unavailable"
