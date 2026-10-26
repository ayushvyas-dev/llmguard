"""Admin key management endpoints."""

from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit_event
from app.auth.dependencies import require_admin_auth
from app.auth.keys import generate_key, hash_key
from app.auth.service import AuthResult
from app.core.clock import utc_now
from app.core.errors import GatewayError
from app.db.models import ApiKey, Client, KeyStatus
from app.schemas.admin import KeyCreate, KeyCreatedResponse, KeyResponse

router = APIRouter(tags=["admin-keys"])


async def get_session(request: Request) -> AsyncSession:
    async with request.app.state.session_factory() as session:
        yield session


@router.post("/clients/{client_id}/keys", response_model=KeyCreatedResponse, status_code=201)
async def create_key_for_client(
    client_id: UUID,
    payload: KeyCreate,
    request: Request,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> KeyCreatedResponse:
    # Verify client exists
    result = await session.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise GatewayError(
            status_code=404,
            code="client_not_found",
            message=f"Client '{client_id}' not found.",
            error_type="invalid_request_error",
        )

    settings = request.app.state.settings
    pepper = settings.api_key_pepper or ""
    full_key, prefix, secret = generate_key(settings.app_env, role=payload.role.value)
    key_hash = hash_key(secret, pepper)

    expires_at = None
    if payload.expires_in_days:
        expires_at = utc_now() + timedelta(days=payload.expires_in_days)

    db_key = ApiKey(
        id=uuid4(),
        client_id=client.id,
        prefix=prefix,
        key_hash=key_hash,
        role=payload.role,
        status=KeyStatus.ACTIVE,
        expires_at=expires_at,
        label=payload.label,
    )
    session.add(db_key)
    await session.commit()
    await session.refresh(db_key)

    # Record audit event (NEVER include raw secret in summary)
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="key.create",
        target_type="key",
        target_id=prefix,
        summary={
            "client_id": str(client.id),
            "prefix": prefix,
            "role": payload.role.value,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "label": payload.label,
        },
    )

    return KeyCreatedResponse(
        id=db_key.id,
        client_id=db_key.client_id,
        prefix=db_key.prefix,
        role=db_key.role,
        status=db_key.status,
        label=db_key.label,
        expires_at=db_key.expires_at,
        last_used_at=db_key.last_used_at,
        created_at=utc_now(),
        key=full_key,
    )


@router.get("/clients/{client_id}/keys", response_model=list[KeyResponse])
async def list_keys_for_client(
    client_id: UUID,
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> list[KeyResponse]:
    result = await session.execute(
        select(ApiKey).where(ApiKey.client_id == client_id).order_by(ApiKey.prefix)
    )
    keys = result.scalars().all()
    return [
        KeyResponse(
            id=k.id,
            client_id=k.client_id,
            prefix=k.prefix,
            role=k.role,
            status=k.status,
            label=k.label,
            expires_at=k.expires_at,
            last_used_at=k.last_used_at,
            created_at=None,
        )
        for k in keys
    ]


@router.post("/keys/{prefix}/revoke", response_model=KeyResponse)
async def revoke_key(
    prefix: str,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> KeyResponse:
    result = await session.execute(select(ApiKey).where(ApiKey.prefix == prefix))
    db_key = result.scalar_one_or_none()
    if db_key is None:
        raise GatewayError(
            status_code=404,
            code="key_not_found",
            message=f"Key with prefix '{prefix}' not found.",
            error_type="invalid_request_error",
        )

    db_key.status = KeyStatus.REVOKED
    db_key.revoked_at = utc_now()
    await session.commit()
    await session.refresh(db_key)

    # Record audit event
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="key.revoke",
        target_type="key",
        target_id=prefix,
        summary={"prefix": prefix, "client_id": str(db_key.client_id)},
    )

    return KeyResponse(
        id=db_key.id,
        client_id=db_key.client_id,
        prefix=db_key.prefix,
        role=db_key.role,
        status=db_key.status,
        label=db_key.label,
        expires_at=db_key.expires_at,
        last_used_at=db_key.last_used_at,
        created_at=None,
    )
