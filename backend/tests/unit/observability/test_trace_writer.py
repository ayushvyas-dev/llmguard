"""Unit tests for TraceWriter queue overflow, dead-letter logging, and sync/async modes."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import RequestTrace, UsageRecord
from app.observability.writer import TraceWriter


@pytest.fixture
async def test_session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


async def test_sync_mode_writes_directly(test_session_factory) -> None:
    writer = TraceWriter(session_factory=test_session_factory, mode="sync")

    trace_data = {
        "request_id": f"req_{uuid4().hex}",
        "correlation_id": "corr_sync",
        "status": "success",
        "http_status": 200,
        "latency_ms": 15,
        "input_chars": 10,
        "output_chars": 20,
    }
    usage_data = {
        "request_id": trace_data["request_id"],
        "status": "success",
        "tokens_source": "provider",
        "cost_status": "unpriced",
    }

    await writer.write(trace_data, usage_data)

    async with test_session_factory() as session:
        t = await session.get(RequestTrace, trace_data["request_id"])
        u = await session.get(UsageRecord, trace_data["request_id"])
        assert t is not None
        assert u is not None
        assert t.http_status == 200


async def test_queue_overflow_dead_letters_without_crashing(test_session_factory, capsys) -> None:
    # Very small queue size of 1
    writer = TraceWriter(session_factory=test_session_factory, queue_size=1, mode="async")
    # Do NOT start background worker so queue fills up

    item1_trace = {"request_id": "req_1"}
    item1_usage = {"request_id": "req_1"}
    await writer.write(item1_trace, item1_usage)

    # Second item exceeds queue size
    item2_trace = {"request_id": "req_2"}
    item2_usage = {"request_id": "req_2"}

    # Must NOT raise exception
    await writer.write(item2_trace, item2_usage)

    captured = capsys.readouterr()
    assert "DEAD-LETTER" in captured.err
    assert "trace_dead_letter_queue_overflow" in captured.err


async def test_db_failure_dead_letters_without_crashing(capsys) -> None:
    # Session factory that raises an error on commit/begin
    bad_factory = MagicMock()
    bad_factory.begin.side_effect = RuntimeError("Database connection refused")

    writer = TraceWriter(session_factory=bad_factory, mode="sync")

    trace_data = {"request_id": "req_fail"}
    usage_data = {"request_id": "req_fail"}

    # Must NOT crash the caller
    await writer.write(trace_data, usage_data)

    captured = capsys.readouterr()
    assert "DEAD-LETTER" in captured.err
    assert "trace_dead_letter_db_error" in captured.err
