"""Admin client management endpoints."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit_event
from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.core.clock import utc_now
from app.core.errors import GatewayError
from app.db.models import Client
from app.schemas.admin import ClientCreate, ClientResponse, ClientUpdate

router = APIRouter(prefix="/clients", tags=["admin-clients"])


async def get_session(request: Request) -> AsyncSession:
    async with request.app.state.session_factory() as session:
        yield session


@router.post("", response_model=ClientResponse, status_code=201)
async def create_client(
    payload: ClientCreate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> ClientResponse:
    # Check for duplicate name
    existing = await session.execute(select(Client).where(Client.name == payload.name))
    if existing.scalar_one_or_none() is not None:
        raise GatewayError(
            status_code=409,
            code="client_conflict",
            message=f"Client with name '{payload.name}' already exists.",
        )

    now = utc_now()
    client = Client(
        id=uuid4(),
        name=payload.name,
        status=payload.status,
        security_policy_id=payload.security_policy_id,
        routing_policy_id=payload.routing_policy_id,
        rate_limit_rpm=payload.rate_limit_rpm,
        window_seconds=payload.window_seconds,
        daily_token_quota=payload.daily_token_quota,
        monthly_cost_quota=payload.monthly_cost_quota,
        allowed_models=payload.allowed_models,
        store_content=payload.store_content,
        created_at=now,
        updated_at=now,
    )
    session.add(client)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise GatewayError(
            status_code=409,
            code="client_conflict",
            message=f"Client with name '{payload.name}' already exists.",
        ) from exc

    await session.refresh(client)

    # Record audit event
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="client.create",
        target_type="client",
        target_id=str(client.id),
        summary={
            "name": client.name,
            "status": client.status,
            "rate_limit_rpm": client.rate_limit_rpm,
            "allowed_models": client.allowed_models,
        },
    )

    return ClientResponse.model_validate(client, from_attributes=True)


@router.get("", response_model=list[ClientResponse])
async def list_clients(
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> list[ClientResponse]:
    result = await session.execute(select(Client).order_by(Client.created_at.desc()))
    clients = result.scalars().all()
    return [ClientResponse.model_validate(c, from_attributes=True) for c in clients]


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: UUID,
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> ClientResponse:
    result = await session.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise GatewayError(
            status_code=404,
            code="client_not_found",
            message=f"Client '{client_id}' not found.",
            error_type="invalid_request_error",
        )
    return ClientResponse.model_validate(client, from_attributes=True)


@router.patch("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: UUID,
    payload: ClientUpdate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> ClientResponse:
    result = await session.execute(select(Client).where(Client.id == client_id))
    client = result.scalar_one_or_none()
    if client is None:
        raise GatewayError(
            status_code=404,
            code="client_not_found",
            message=f"Client '{client_id}' not found.",
            error_type="invalid_request_error",
        )

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] != client.name:
        existing = await session.execute(select(Client).where(Client.name == updates["name"]))
        if existing.scalar_one_or_none() is not None:
            raise GatewayError(
                status_code=409,
                code="client_conflict",
                message=f"Client with name '{updates['name']}' already exists.",
            )

    for field, val in updates.items():
        setattr(client, field, val)

    client.updated_at = utc_now()
    await session.commit()
    await session.refresh(client)

    # Record audit event
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="client.update",
        target_type="client",
        target_id=str(client.id),
        summary={"updated_fields": list(updates.keys())},
    )

    return ClientResponse.model_validate(client, from_attributes=True)
