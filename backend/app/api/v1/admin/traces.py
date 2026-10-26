"""Admin API endpoints for request traces."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.core.errors import GatewayError
from app.db.models import RequestTrace

router = APIRouter(prefix="/traces", tags=["admin-traces"])


@router.get("")
async def list_traces(
    request: Request,
    client_id: UUID | None = Query(None),
    status: str | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """List request traces with filtering and pagination."""
    session_factory = request.app.state.session_factory

    stmt = select(RequestTrace)
    count_stmt = select(func.count()).select_from(RequestTrace)

    if client_id:
        stmt = stmt.where(RequestTrace.client_id == client_id)
        count_stmt = count_stmt.where(RequestTrace.client_id == client_id)
    if status:
        stmt = stmt.where(RequestTrace.status == status)
        count_stmt = count_stmt.where(RequestTrace.status == status)
    if start_time:
        stmt = stmt.where(RequestTrace.started_at >= start_time)
        count_stmt = count_stmt.where(RequestTrace.started_at >= start_time)
    if end_time:
        stmt = stmt.where(RequestTrace.started_at <= end_time)
        count_stmt = count_stmt.where(RequestTrace.started_at <= end_time)

    stmt = stmt.order_by(RequestTrace.started_at.desc()).offset(offset).limit(limit)

    async with session_factory() as session:
        total_res = await session.execute(count_stmt)
        total = total_res.scalar() or 0

        res = await session.execute(stmt)
        traces = res.scalars().all()

        return {
            "total": total,
            "traces": [
                {
                    "request_id": t.request_id,
                    "correlation_id": t.correlation_id,
                    "client_id": str(t.client_id) if t.client_id else None,
                    "started_at": t.started_at.isoformat() if t.started_at else None,
                    "status": t.status,
                    "http_status": t.http_status,
                    "error_code": t.error_code,
                    "provider": t.provider,
                    "provider_model": t.provider_model,
                    "fallback_used": t.fallback_used,
                    "retry_count": t.retry_count,
                    "latency_ms": t.latency_ms,
                    "security_decision": t.security_decision,
                    "risk_score": t.risk_score,
                    "cache_status": t.cache_status,
                    "input_chars": t.input_chars,
                    "output_chars": t.output_chars,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                }
                for t in traces
            ],
        }


@router.get("/{request_id}")
async def get_trace(
    request_id: str,
    request: Request,
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Get single trace details including lifecycle events and opt-in content preview."""
    session_factory = request.app.state.session_factory

    async with session_factory() as session:
        res = await session.execute(
            select(RequestTrace).where(RequestTrace.request_id == request_id)
        )
        t = res.scalar_one_or_none()
        if t is None:
            raise GatewayError(404, "trace_not_found", f"Trace '{request_id}' not found.")

        return {
            "request_id": t.request_id,
            "correlation_id": t.correlation_id,
            "client_id": str(t.client_id) if t.client_id else None,
            "started_at": t.started_at.isoformat() if t.started_at else None,
            "status": t.status,
            "http_status": t.http_status,
            "error_code": t.error_code,
            "provider": t.provider,
            "provider_model": t.provider_model,
            "fallback_used": t.fallback_used,
            "retry_count": t.retry_count,
            "latency_ms": t.latency_ms,
            "security_decision": t.security_decision,
            "risk_score": t.risk_score,
            "policy_version": t.policy_version,
            "cache_status": t.cache_status,
            "prompt_hash": t.prompt_hash,
            "input_chars": t.input_chars,
            "output_chars": t.output_chars,
            "events": t.events or [],
            "content_preview": t.content_preview,
            "content_expires_at": (
                t.content_expires_at.isoformat() if t.content_expires_at else None
            ),
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
