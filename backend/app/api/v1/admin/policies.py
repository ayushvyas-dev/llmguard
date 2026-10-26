"""Admin policy management endpoints."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit_event
from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.core.clock import utc_now
from app.core.errors import GatewayError
from app.db.models import (
    RoutingPolicy as DbRoutingPolicy,
)
from app.db.models import (
    SecurityPolicy as DbSecurityPolicy,
)
from app.routing.policy import RoutingPolicy as RoutingPolicyModel
from app.schemas.admin import (
    RoutingPolicyCreate,
    RoutingPolicyResponse,
    RoutingPolicyUpdate,
    SecurityPolicyCreate,
    SecurityPolicyResponse,
    SecurityPolicyUpdate,
)
from app.security.policy import SecurityPolicy as PolicyModel

router = APIRouter(prefix="/policies", tags=["admin-policies"])


async def get_session(request: Request) -> AsyncSession:
    async with request.app.state.session_factory() as session:
        yield session


# --- Routing Policy Endpoints ---


@router.post("/routing", response_model=RoutingPolicyResponse, status_code=201)
async def create_routing_policy(
    payload: RoutingPolicyCreate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> RoutingPolicyResponse:
    try:
        RoutingPolicyModel.model_validate(payload.config)
    except ValidationError as exc:
        raise GatewayError(
            status_code=422,
            code="invalid_policy",
            message=f"Invalid routing policy configuration: {exc}",
            error_type="invalid_request_error",
        ) from exc

    now = utc_now()
    db_policy = DbRoutingPolicy(
        id=uuid4(),
        name=payload.name,
        version=1,
        config=payload.config,
        is_default=payload.is_default,
        created_by=admin_auth.prefix,
        created_at=now,
    )
    session.add(db_policy)
    await session.commit()
    await session.refresh(db_policy)

    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="policy.routing.create",
        target_type="routing_policy",
        target_id=str(db_policy.id),
        summary={"name": db_policy.name, "version": db_policy.version},
    )

    return RoutingPolicyResponse.model_validate(db_policy, from_attributes=True)


@router.get("/routing", response_model=list[RoutingPolicyResponse])
async def list_routing_policies(
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> list[RoutingPolicyResponse]:
    result = await session.execute(
        select(DbRoutingPolicy).order_by(DbRoutingPolicy.created_at.desc())
    )
    policies = result.scalars().all()
    return [RoutingPolicyResponse.model_validate(p, from_attributes=True) for p in policies]


@router.get("/routing/{policy_id}", response_model=RoutingPolicyResponse)
async def get_routing_policy(
    policy_id: UUID,
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> RoutingPolicyResponse:
    result = await session.execute(select(DbRoutingPolicy).where(DbRoutingPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if policy is None:
        raise GatewayError(
            status_code=404,
            code="routing_policy_not_found",
            message=f"Routing policy '{policy_id}' not found.",
            error_type="invalid_request_error",
        )
    return RoutingPolicyResponse.model_validate(policy, from_attributes=True)


@router.put("/routing/{policy_id}", response_model=RoutingPolicyResponse)
async def update_routing_policy(
    policy_id: UUID,
    payload: RoutingPolicyUpdate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> RoutingPolicyResponse:
    result = await session.execute(select(DbRoutingPolicy).where(DbRoutingPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if policy is None:
        raise GatewayError(
            status_code=404,
            code="routing_policy_not_found",
            message=f"Routing policy '{policy_id}' not found.",
            error_type="invalid_request_error",
        )

    try:
        RoutingPolicyModel.model_validate(payload.config)
    except ValidationError as exc:
        raise GatewayError(
            status_code=422,
            code="invalid_policy",
            message=f"Invalid routing policy configuration: {exc}",
            error_type="invalid_request_error",
        ) from exc

    policy.config = payload.config
    policy.version += 1
    if payload.is_default is not None:
        policy.is_default = payload.is_default

    await session.commit()
    await session.refresh(policy)

    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="policy.routing.update",
        target_type="routing_policy",
        target_id=str(policy.id),
        summary={"name": policy.name, "new_version": policy.version},
    )

    return RoutingPolicyResponse.model_validate(policy, from_attributes=True)


# --- Security Policy Endpoints ---


@router.post("", response_model=SecurityPolicyResponse, status_code=201)
async def create_policy(
    payload: SecurityPolicyCreate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> SecurityPolicyResponse:
    # Validate the policy configuration using the domain model
    try:
        PolicyModel.model_validate(payload.config)
    except ValidationError as exc:
        raise GatewayError(
            status_code=422,
            code="invalid_policy",
            message=f"Invalid security policy configuration: {exc}",
            error_type="invalid_request_error",
        ) from exc

    now = utc_now()
    db_policy = DbSecurityPolicy(
        id=uuid4(),
        name=payload.name,
        version=1,
        config=payload.config,
        is_default=payload.is_default,
        created_by=admin_auth.prefix,
        created_at=now,
    )
    session.add(db_policy)
    await session.commit()
    await session.refresh(db_policy)

    # Record audit event
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="policy.create",
        target_type="policy",
        target_id=str(db_policy.id),
        summary={"name": db_policy.name, "version": db_policy.version},
    )

    return SecurityPolicyResponse.model_validate(db_policy, from_attributes=True)


@router.get("", response_model=list[SecurityPolicyResponse])
async def list_policies(
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> list[SecurityPolicyResponse]:
    result = await session.execute(
        select(DbSecurityPolicy).order_by(DbSecurityPolicy.created_at.desc())
    )
    policies = result.scalars().all()
    return [SecurityPolicyResponse.model_validate(p, from_attributes=True) for p in policies]


@router.get("/{policy_id}", response_model=SecurityPolicyResponse)
async def get_policy(
    policy_id: UUID,
    _admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> SecurityPolicyResponse:
    result = await session.execute(select(DbSecurityPolicy).where(DbSecurityPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if policy is None:
        raise GatewayError(
            status_code=404,
            code="policy_not_found",
            message=f"Policy '{policy_id}' not found.",
            error_type="invalid_request_error",
        )
    return SecurityPolicyResponse.model_validate(policy, from_attributes=True)


@router.put("/{policy_id}", response_model=SecurityPolicyResponse)
async def update_policy(
    policy_id: UUID,
    payload: SecurityPolicyUpdate,
    admin_auth: AuthResult = Depends(require_admin_auth),
    session: AsyncSession = Depends(get_session),
) -> SecurityPolicyResponse:
    result = await session.execute(select(DbSecurityPolicy).where(DbSecurityPolicy.id == policy_id))
    policy = result.scalar_one_or_none()
    if policy is None:
        raise GatewayError(
            status_code=404,
            code="policy_not_found",
            message=f"Policy '{policy_id}' not found.",
            error_type="invalid_request_error",
        )

    # Validate updated config
    try:
        PolicyModel.model_validate(payload.config)
    except ValidationError as exc:
        raise GatewayError(
            status_code=422,
            code="invalid_policy",
            message=f"Invalid security policy configuration: {exc}",
            error_type="invalid_request_error",
        ) from exc

    policy.config = payload.config
    policy.version += 1
    if payload.is_default is not None:
        policy.is_default = payload.is_default

    await session.commit()
    await session.refresh(policy)

    # Record audit event
    await record_audit_event(
        session,
        actor=admin_auth.prefix,
        action="policy.update",
        target_type="policy",
        target_id=str(policy.id),
        summary={"name": policy.name, "new_version": policy.version},
    )

    return SecurityPolicyResponse.model_validate(policy, from_attributes=True)
