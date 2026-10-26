"""Audit logging service for admin mutations."""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utc_now
from app.db.models import AuditEvent


async def record_audit_event(
    session: AsyncSession,
    *,
    actor: str,
    action: str,
    target_type: str,
    target_id: str,
    summary: dict,
) -> AuditEvent:
    """Synchronously record an audit event for an administrative mutation.

    Ensures no secrets (raw keys, peppers, tokens) are ever stored in the summary.
    """
    event = AuditEvent(
        id=uuid4(),
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        summary=summary,
        created_at=utc_now(),
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event
