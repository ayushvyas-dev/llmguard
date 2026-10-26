"""Authentication service: key lookup, verification, client loading."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.keys import verify_key
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus


class AuthFailure:
    """Structured auth rejection with an internal reason (never shown to clients)."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    def __repr__(self) -> str:
        return f"AuthFailure({self.reason!r})"


class AuthResult:
    """Successful authentication result carrying the client and key metadata."""

    def __init__(self, client: Client, key: ApiKey) -> None:
        self.client = client
        self.key = key
        self.client_id: UUID = client.id
        self.role: KeyRole = key.role
        self.prefix: str = key.prefix

    def __repr__(self) -> str:
        return f"AuthResult(client={self.client.name!r}, role={self.role})"


# Minimum interval between last_used_at updates to limit write load (seconds).
_LAST_USED_UPDATE_INTERVAL = 300


async def authenticate(
    bearer_token: str,
    pepper: str,
    session: AsyncSession,
) -> AuthResult | AuthFailure:
    """Parse a bearer token, look up the key by prefix, verify, and load the client.

    Returns AuthResult on success or AuthFailure with an internal reason code.
    The caller must translate failures into generic 401/403 responses (never exposing
    the reason to the client).
    """
    parts = bearer_token.split("_", 3)
    # Expected: namespace_env_prefix_secret  (4 parts)
    if len(parts) != 4:
        return AuthFailure("malformed_key")

    namespace, _env, prefix, secret = parts
    if namespace not in ("lg", "lga"):
        return AuthFailure("malformed_key")

    # Look up by prefix
    result = await session.execute(select(ApiKey).where(ApiKey.prefix == prefix))
    key_row = result.scalar_one_or_none()
    if key_row is None:
        return AuthFailure("unknown_prefix")

    # Verify HMAC in constant time
    if not verify_key(secret, key_row.key_hash, pepper):
        return AuthFailure("wrong_secret")

    # Check key status
    if key_row.status == KeyStatus.REVOKED:
        return AuthFailure("revoked")

    # Check expiry
    if key_row.expires_at:
        expires_at = key_row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            return AuthFailure("expired")

    # Verify namespace matches role
    expected_namespace = "lga" if key_row.role == KeyRole.ADMIN else "lg"
    if namespace != expected_namespace:
        return AuthFailure("malformed_key")

    # Load the client
    client_result = await session.execute(select(Client).where(Client.id == key_row.client_id))
    client = client_result.scalar_one_or_none()
    if client is None:
        return AuthFailure("client_not_found")

    if client.status == ClientStatus.DISABLED:
        return AuthFailure("client_disabled")

    # Throttled last_used_at update to limit write load
    now = datetime.now(UTC)
    last_used = key_row.last_used_at
    if last_used and last_used.tzinfo is None:
        last_used = last_used.replace(tzinfo=UTC)
    if last_used is None or (now - last_used).total_seconds() > _LAST_USED_UPDATE_INTERVAL:
        await session.execute(
            update(ApiKey).where(ApiKey.id == key_row.id).values(last_used_at=now)
        )
        await session.commit()

    return AuthResult(client, key_row)
