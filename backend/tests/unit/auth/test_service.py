"""Unit tests for the auth service — uses in-memory SQLite for isolation."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.keys import hash_key
from app.auth.service import AuthFailure, AuthResult, authenticate
from app.db.base import Base
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus

TEST_PEPPER = "test_pepper_for_unit_tests_32chars!"


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _create_client_and_key(
    session: AsyncSession,
    *,
    client_status: ClientStatus = ClientStatus.ACTIVE,
    key_role: KeyRole = KeyRole.CLIENT,
    key_status: KeyStatus = KeyStatus.ACTIVE,
    expires_at: datetime | None = None,
    secret: str = "test_secret_value_at_least_32_chars",
    prefix: str = "testpfx1",
    namespace: str = "lg",
    env_tag: str = "dev",
) -> tuple[Client, ApiKey, str]:
    """Helper to insert a client + key and return (client, key, full_bearer_token)."""
    client = Client(id=uuid4(), name=f"test-{uuid4().hex[:8]}", status=client_status)
    session.add(client)
    key = ApiKey(
        id=uuid4(),
        client_id=client.id,
        prefix=prefix,
        key_hash=hash_key(secret, TEST_PEPPER),
        role=key_role,
        status=key_status,
        expires_at=expires_at,
    )
    session.add(key)
    await session.commit()
    full_token = f"{namespace}_{env_tag}_{prefix}_{secret}"
    return client, key, full_token


class TestAuthenticate:
    async def test_valid_client_key(self, session: AsyncSession) -> None:
        client, key, token = await _create_client_and_key(session)
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthResult)
        assert result.client_id == client.id
        assert result.role == KeyRole.CLIENT

    async def test_valid_admin_key(self, session: AsyncSession) -> None:
        _, _, token = await _create_client_and_key(
            session,
            key_role=KeyRole.ADMIN,
            namespace="lga",
            prefix="admpfx01",
        )
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthResult)
        assert result.role == KeyRole.ADMIN

    async def test_malformed_key_too_few_parts(self, session: AsyncSession) -> None:
        result = await authenticate("lg_dev_tooshort", TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "malformed_key"

    async def test_malformed_key_bad_namespace(self, session: AsyncSession) -> None:
        result = await authenticate("bad_dev_prefix1_secret", TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "malformed_key"

    async def test_unknown_prefix(self, session: AsyncSession) -> None:
        result = await authenticate("lg_dev_unknown1_somesecret", TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "unknown_prefix"

    async def test_wrong_secret(self, session: AsyncSession) -> None:
        _, _, _ = await _create_client_and_key(session, prefix="wrngsec1")
        result = await authenticate(
            "lg_dev_wrngsec1_completely_wrong_secret_value", TEST_PEPPER, session
        )
        assert isinstance(result, AuthFailure)
        assert result.reason == "wrong_secret"

    async def test_revoked_key(self, session: AsyncSession) -> None:
        _, _, token = await _create_client_and_key(
            session, key_status=KeyStatus.REVOKED, prefix="revoked1"
        )
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "revoked"

    async def test_expired_key(self, session: AsyncSession) -> None:
        expired = datetime.now(UTC) - timedelta(hours=1)
        _, _, token = await _create_client_and_key(session, expires_at=expired, prefix="expired1")
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "expired"

    async def test_disabled_client(self, session: AsyncSession) -> None:
        _, _, token = await _create_client_and_key(
            session, client_status=ClientStatus.DISABLED, prefix="disabld1"
        )
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthFailure)
        assert result.reason == "client_disabled"

    async def test_namespace_role_mismatch_client_key_with_admin_namespace(
        self, session: AsyncSession
    ) -> None:
        """A client key used with the 'lga' namespace should be rejected."""
        _, _, _ = await _create_client_and_key(session, key_role=KeyRole.CLIENT, prefix="mismtch1")
        # Manually forge the token with lga namespace
        result = await authenticate(
            "lga_dev_mismtch1_test_secret_value_at_least_32_chars",
            TEST_PEPPER,
            session,
        )
        assert isinstance(result, AuthFailure)
        assert result.reason == "malformed_key"

    async def test_last_used_at_updated(self, session: AsyncSession) -> None:
        client, key, token = await _create_client_and_key(session, prefix="lastuse1")
        assert key.last_used_at is None
        result = await authenticate(token, TEST_PEPPER, session)
        assert isinstance(result, AuthResult)
        # Re-fetch the key
        refreshed = await session.get(ApiKey, key.id)
        assert refreshed.last_used_at is not None


class TestDatabaseContainsNoPlaintextKey:
    async def test_key_hash_is_not_plaintext(self, session: AsyncSession) -> None:
        secret = "plaintext_secret_that_must_not_appear"
        _, key, _ = await _create_client_and_key(session, secret=secret, prefix="noplain1")
        # The hash should NOT contain the raw secret bytes
        assert secret.encode() not in key.key_hash
        # Re-fetch from DB to double-check
        row = await session.get(ApiKey, key.id)
        assert secret.encode() not in row.key_hash
