"""Durable trace and usage persistence writer with sync and async modes."""

import asyncio
import sys
from datetime import UTC, datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import RequestTrace, UsageRecord

logger = structlog.get_logger(__name__)


class TraceWriter:
    """Async background worker with bounded queue and sync fallback for block events."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        queue_size: int = 1000,
        mode: str = "async",
    ) -> None:
        self.session_factory = session_factory
        self.queue_size = queue_size
        self.mode = mode
        self.queue: asyncio.Queue[tuple[dict, dict] | None] = asyncio.Queue(maxsize=queue_size)
        self.worker_task: asyncio.Task | None = None
        self._running = False

    def start(self) -> None:
        """Start the background consumer task."""
        if self._running or self.mode == "sync":
            return
        self._running = True
        self.worker_task = asyncio.create_task(self._worker())

    async def stop(self) -> None:
        """Stop worker and flush remaining items."""
        if not self._running:
            return
        self._running = False
        await self.queue.put(None)
        if self.worker_task:
            await self.worker_task

    async def _worker(self) -> None:
        """Background queue processor."""
        while True:
            item = await self.queue.get()
            if item is None:
                self.queue.task_done()
                break

            trace_data, usage_data = item
            try:
                await self._persist_rows(trace_data, usage_data)
            except Exception as e:
                self._dead_letter("trace_dead_letter_db_error", trace_data, error=str(e))
            finally:
                self.queue.task_done()

    async def _persist_rows(self, trace_data: dict, usage_data: dict) -> None:
        """Save trace and usage rows to database."""
        async with self.session_factory.begin() as session:
            trace = RequestTrace(**trace_data)
            usage = UsageRecord(**usage_data)
            session.add(trace)
            session.add(usage)

    def _dead_letter(self, event_name: str, trace_data: dict, error: str | None = None) -> None:
        """Emit dead-letter record to stderr and structured logger without failing requests."""
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "request_id": trace_data.get("request_id"),
            "client_id": str(trace_data.get("client_id")),
            "error": error,
        }
        logger.error(event_name, **record)
        full_record = {"event": event_name, **record}
        print(f"DEAD-LETTER: {full_record}", file=sys.stderr)

    async def write(self, trace_data: dict, usage_data: dict, force_sync: bool = False) -> None:
        """Write trace and usage.

        Uses sync persistence if configured or forced (e.g. security blocks).
        """
        if self.mode == "sync" or force_sync:
            try:
                await self._persist_rows(trace_data, usage_data)
            except Exception as e:
                self._dead_letter("trace_dead_letter_db_error", trace_data, error=str(e))
            return

        try:
            self.queue.put_nowait((trace_data, usage_data))
        except asyncio.QueueFull:
            self._dead_letter("trace_dead_letter_queue_overflow", trace_data, error="Queue full")
