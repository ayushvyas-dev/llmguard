"""Unit tests for retention cleanup with simulated fake clocks."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.base import Base
from app.db.models import RequestTrace, SecurityEvent, UsageRecord
from app.observability.cleanup import cleanup_retention


@pytest.fixture
async def cleanup_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


async def test_retention_cleanup_with_fake_clock(cleanup_db) -> None:
    now = datetime(2026, 10, 25, 12, 0, 0, tzinfo=UTC)

    def fake_clock() -> datetime:
        return now

    settings = Settings(
        trace_retention_days=30,
        security_event_retention_days=90,
        usage_retention_days=365,
    )

    t_recent = now - timedelta(days=5)
    t_old_trace = now - timedelta(days=35)
    t_old_sec = now - timedelta(days=95)
    t_old_usage = now - timedelta(days=370)

    async with cleanup_db() as session:
        # 1. Traces: 1 recent (with expired content), 1 old (to be deleted)
        session.add(
            RequestTrace(
                request_id="trace_recent",
                correlation_id="corr_1",
                status="success",
                http_status=200,
                latency_ms=10,
                content_preview={"prompt": "preview"},
                content_expires_at=now - timedelta(hours=1),  # Expired
                created_at=t_recent,
            )
        )
        session.add(
            RequestTrace(
                request_id="trace_old",
                correlation_id="corr_2",
                status="success",
                http_status=200,
                latency_ms=10,
                created_at=t_old_trace,
            )
        )

        # 2. Security events: 1 recent, 1 old
        session.add(
            SecurityEvent(
                id=uuid4(),
                request_id="trace_recent",
                direction="input",
                category="pii",
                action="redact",
                detector="pii_detector",
                score=0.9,
                reason_codes=["pii_detected"],
                policy_version=1,
                created_at=t_recent,
            )
        )
        session.add(
            SecurityEvent(
                id=uuid4(),
                request_id="trace_old",
                direction="input",
                category="pii",
                action="redact",
                detector="pii_detector",
                score=0.9,
                reason_codes=["pii_detected"],
                policy_version=1,
                created_at=t_old_sec,
            )
        )

        # 3. Usage records: 1 recent, 1 old
        session.add(
            UsageRecord(
                request_id="trace_recent",
                status="success",
                tokens_source="provider",
                cost_status="estimated",
                created_at=t_recent,
            )
        )
        session.add(
            UsageRecord(
                request_id="trace_old",
                status="success",
                tokens_source="provider",
                cost_status="estimated",
                created_at=t_old_usage,
            )
        )

        await session.commit()

    # Run cleanup
    res = await cleanup_retention(cleanup_db, settings, now_fn=fake_clock)
    assert res["content_previews_cleared"] == 1
    assert res["traces_deleted"] == 1
    assert res["security_events_deleted"] == 1
    assert res["usage_records_deleted"] == 1

    # Verify remaining data
    async with cleanup_db() as session:
        # trace_recent still exists, but content_preview is cleared
        t = await session.get(RequestTrace, "trace_recent")
        assert t is not None
        assert t.content_preview is None
        assert t.content_expires_at is None

        # trace_old was deleted
        assert await session.get(RequestTrace, "trace_old") is None

        # 1 security event and 1 usage record remain
        secs = (await session.execute(select(SecurityEvent))).scalars().all()
        assert len(secs) == 1
        usages = (await session.execute(select(UsageRecord))).scalars().all()
        assert len(usages) == 1
