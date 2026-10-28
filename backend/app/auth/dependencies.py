from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import AuthFailure, AuthResult, authenticate
from app.core.errors import GatewayError
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus


async def _get_session(request: Request) -> AsyncSession:
    """Yield an async DB session from the app-level session factory."""
    async with request.app.state.session_factory() as session:
        yield session


def _extract_bearer(request: Request) -> str:
    """Extract the bearer token from the Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise GatewayError(
            401,
            "unauthorized",
            "Authentication is required.",
            "authentication_error",
        )
    return auth_header[7:].strip()


def _auth_failure_to_error(failure: AuthFailure) -> GatewayError:
    """Map internal auth failure reasons to HTTP errors.

    All use a generic public message — the internal reason is for logs only.
    """
    if failure.reason == "client_disabled":
        return GatewayError(
            403,
            "client_disabled",
            "This client account has been disabled.",
            "authentication_error",
        )
    # Everything else is 401 with a generic message
    return GatewayError(
        401,
        "unauthorized",
        "Authentication is required.",
        "authentication_error",
    )


async def require_gateway_auth(
    request: Request,
    session: AsyncSession = Depends(_get_session),
) -> AuthResult:
    """Dependency for gateway endpoints — requires a valid client key."""
    token = _extract_bearer(request)
    pepper = request.app.state.settings.api_key_pepper or ""
    result = await authenticate(token, pepper, session)

    if isinstance(result, AuthFailure):
        raise _auth_failure_to_error(result)

    # Admin keys cannot access gateway endpoints
    if result.role == KeyRole.ADMIN:
        raise GatewayError(
            403,
            "forbidden",
            "Admin keys cannot be used for gateway requests.",
            "authentication_error",
        )

    # Attach auth info to request state for downstream use
    request.state.client = result.client
    request.state.auth = result
    return result


async def require_admin_auth(
    request: Request,
    session: AsyncSession = Depends(_get_session),
) -> AuthResult:
    """Dependency for admin endpoints — requires a valid admin key or demo key."""
    token = _extract_bearer(request)
    settings = getattr(request.app.state, "settings", None)
    demo_key = (
        getattr(settings, "demo_admin_key", "lga_dev_demo0000_recruiter_demo_access_key")
        if settings
        else "lga_dev_demo0000_recruiter_demo_access_key"
    )

    if demo_key and token == demo_key:
        res = await session.execute(
            select(Client)
            .join(ApiKey)
            .where(ApiKey.role == KeyRole.ADMIN, Client.status == ClientStatus.ACTIVE)
            .limit(1)
        )
        admin_client = res.scalar_one_or_none()
        if admin_client is None:
            res = await session.execute(
                select(Client).where(Client.status == ClientStatus.ACTIVE).limit(1)
            )
            admin_client = res.scalar_one_or_none()

        if admin_client is None:
            admin_client = Client(
                id=UUID("00000000-0000-0000-0000-000000000001"),
                name="demo-recruiter",
                status=ClientStatus.ACTIVE,
            )

        demo_key_obj = ApiKey(
            id=UUID("00000000-0000-0000-0000-000000000002"),
            client_id=admin_client.id,
            prefix="demo0000",
            key_hash=b"",
            role=KeyRole.ADMIN,
            status=KeyStatus.ACTIVE,
            label="Demo Recruiter Key",
        )
        result = AuthResult(admin_client, demo_key_obj)
    else:
        pepper = getattr(settings, "api_key_pepper", "") if settings else ""
        result = await authenticate(token, pepper, session)

        if isinstance(result, AuthFailure):
            raise _auth_failure_to_error(result)

        # Only admin keys can access admin endpoints
        if result.role != KeyRole.ADMIN:
            raise GatewayError(
                403,
                "forbidden",
                "This endpoint requires admin credentials.",
                "authentication_error",
            )

    # In demo mode, block all administrative mutations except playground completions
    is_demo = (settings and getattr(settings, "demo_mode", False)) or (result.prefix == "demo0000")
    if is_demo:
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and not request.url.path.endswith(
            "/playground/completions"
        ):
            raise GatewayError(
                403,
                "demo_mode_restricted",
                "Gateway is running in demo mode. Administrative mutations are disabled.",
                "permission_error",
            )

    request.state.client = result.client
    request.state.auth = result
    return result
