"""Retention cleanup for expired request traces, security events, usage records,
and content previews.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.models import RequestTrace, SecurityEvent, UsageRecord


async def cleanup_retention(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    now_fn: Callable[[], datetime] | None = None,
) -> dict[str, int]:
    """Purge rows older than configured retention limits and clear expired content previews."""
    now = now_fn() if now_fn else datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    trace_cutoff = now - timedelta(days=settings.trace_retention_days)
    security_cutoff = now - timedelta(days=settings.security_event_retention_days)
    usage_cutoff = now - timedelta(days=settings.usage_retention_days)

    async with session_factory.begin() as session:
        # 1. Clear expired content previews
        content_stmt = (
            update(RequestTrace)
            .where(
                RequestTrace.content_expires_at.is_not(None),
                RequestTrace.content_expires_at <= now,
            )
            .values(content_preview=None, content_expires_at=None)
        )
        content_res = await session.execute(content_stmt)
        cleaned_content_count = content_res.rowcount

        # 2. Delete expired traces
        trace_stmt = delete(RequestTrace).where(RequestTrace.created_at < trace_cutoff)
        trace_res = await session.execute(trace_stmt)
        deleted_traces = trace_res.rowcount

        # 3. Delete expired security events
        sec_stmt = delete(SecurityEvent).where(SecurityEvent.created_at < security_cutoff)
        sec_res = await session.execute(sec_stmt)
        deleted_security_events = sec_res.rowcount

        # 4. Delete expired usage records
        usage_stmt = delete(UsageRecord).where(UsageRecord.created_at < usage_cutoff)
        usage_res = await session.execute(usage_stmt)
        deleted_usage_records = usage_res.rowcount

    return {
        "content_previews_cleared": cleaned_content_count,
        "traces_deleted": deleted_traces,
        "security_events_deleted": deleted_security_events,
        "usage_records_deleted": deleted_usage_records,
    }
