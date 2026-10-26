"""Admin API endpoints for security events."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.db.models import SecurityEvent

router = APIRouter(prefix="/security", tags=["admin-security"])


@router.get("/events")
async def list_security_events(
    request: Request,
    client_id: UUID | None = Query(None),
    category: str | None = Query(None),
    action: str | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """List security events without raw sensitive contents."""
    session_factory = request.app.state.session_factory

    stmt = select(SecurityEvent)
    count_stmt = select(func.count()).select_from(SecurityEvent)

    if client_id:
        stmt = stmt.where(SecurityEvent.client_id == client_id)
        count_stmt = count_stmt.where(SecurityEvent.client_id == client_id)
    if category:
        stmt = stmt.where(SecurityEvent.category == category)
        count_stmt = count_stmt.where(SecurityEvent.category == category)
    if action:
        stmt = stmt.where(SecurityEvent.action == action)
        count_stmt = count_stmt.where(SecurityEvent.action == action)
    if start_time:
        stmt = stmt.where(SecurityEvent.created_at >= start_time)
        count_stmt = count_stmt.where(SecurityEvent.created_at >= start_time)
    if end_time:
        stmt = stmt.where(SecurityEvent.created_at <= end_time)
        count_stmt = count_stmt.where(SecurityEvent.created_at <= end_time)

    stmt = stmt.order_by(SecurityEvent.created_at.desc()).offset(offset).limit(limit)

    async with session_factory() as session:
        total_res = await session.execute(count_stmt)
        total = total_res.scalar() or 0

        res = await session.execute(stmt)
        events = res.scalars().all()

        return {
            "total": total,
            "events": [
                {
                    "id": str(e.id),
                    "request_id": e.request_id,
                    "client_id": str(e.client_id) if e.client_id else None,
                    "direction": e.direction,
                    "category": e.category,
                    "action": e.action,
                    "detector": e.detector,
                    "score": e.score,
                    "reason_codes": e.reason_codes,
                    "policy_version": e.policy_version,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in events
            ],
        }
