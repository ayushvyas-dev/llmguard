"""Lifecycle event recorder and trace builder for request observability."""

import hashlib
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID


class TraceRecorder:
    """Records ordered lifecycle events and builds durable trace & usage records."""

    def __init__(
        self,
        request_id: str,
        correlation_id: str,
        client_id: UUID | None = None,
        store_content: bool = False,
        max_events: int = 100,
        max_bytes: int = 65_536,
        content_retention_days: int = 7,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.request_id = request_id
        self.correlation_id = correlation_id
        self.client_id = client_id
        self.store_content = store_content
        self.max_events = max_events
        self.max_bytes = max_bytes
        self.content_retention_days = content_retention_days
        self.clock = clock or time.time
        self.start_mono = time.perf_counter()
        self.started_at = datetime.now(UTC)

        self.events: list[dict] = []
        self._truncated: bool = False

    def record_event(
        self,
        name: str,
        duration_ms: int = 0,
        outcome: str = "ok",
        attributes: dict | None = None,
    ) -> None:
        """Record an ordered lifecycle event."""
        if self._truncated:
            return

        if len(self.events) >= self.max_events:
            self.events.append(
                {
                    "name": "truncated",
                    "timestamp": datetime.now(UTC).isoformat(),
                    "duration_ms": 0,
                    "outcome": "warning",
                    "attributes": {"reason": "max_events_exceeded"},
                }
            )
            self._truncated = True
            return

        self.events.append(
            {
                "name": name,
                "timestamp": datetime.now(UTC).isoformat(),
                "duration_ms": max(0, duration_ms),
                "outcome": outcome,
                "attributes": attributes or {},
            }
        )

    def _truncate_events_if_oversize(self) -> list[dict]:
        """Ensure serialized events do not exceed max_bytes."""
        raw = json.dumps(self.events)
        if len(raw.encode("utf-8")) <= self.max_bytes:
            return self.events

        # Truncate to half and add truncation marker
        truncated_events = self.events[: self.max_events // 2]
        truncated_events.append(
            {
                "name": "truncated",
                "timestamp": datetime.now(UTC).isoformat(),
                "duration_ms": 0,
                "outcome": "warning",
                "attributes": {"reason": "max_bytes_exceeded"},
            }
        )
        return truncated_events

    def build_trace(
        self,
        status: str,
        http_status: int,
        error_code: str | None = None,
        provider: str | None = None,
        provider_model: str | None = None,
        fallback_used: bool = False,
        retry_count: int = 0,
        latency_ms: int | None = None,
        security_decision: str | None = None,
        risk_score: float | None = None,
        policy_version: int | None = None,
        cache_status: str | None = None,
        prompt_text: str | None = None,
        output_text: str | None = None,
    ) -> dict:
        """Construct dictionary representation for RequestTrace row."""
        duration = (
            latency_ms
            if latency_ms is not None
            else int((time.perf_counter() - self.start_mono) * 1000)
        )
        bounded_events = self._truncate_events_if_oversize()

        prompt_hash = None
        input_chars = 0
        if prompt_text:
            input_chars = len(prompt_text)
            prompt_hash = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()

        output_chars = len(output_text) if output_text else 0

        content_preview = None
        content_expires_at = None
        if self.store_content:
            content_preview = {
                "prompt": prompt_text,
                "output": output_text,
            }
            content_expires_at = datetime.now(UTC) + timedelta(days=self.content_retention_days)

        return {
            "request_id": self.request_id,
            "correlation_id": self.correlation_id,
            "client_id": self.client_id,
            "started_at": self.started_at,
            "status": status,
            "http_status": http_status,
            "error_code": error_code,
            "provider": provider,
            "provider_model": provider_model,
            "fallback_used": fallback_used,
            "retry_count": retry_count,
            "latency_ms": duration,
            "security_decision": security_decision,
            "risk_score": risk_score,
            "policy_version": policy_version,
            "cache_status": cache_status,
            "prompt_hash": prompt_hash,
            "input_chars": input_chars,
            "output_chars": output_chars,
            "events": bounded_events,
            "content_preview": content_preview,
            "content_expires_at": content_expires_at,
            "created_at": datetime.now(UTC),
        }

    def build_usage(
        self,
        status: str,
        provider: str | None = None,
        provider_model: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        tokens_source: str = "missing",
        estimated_cost=None,
        cost_status: str = "unpriced",
        cache_hit: bool = False,
        saved_tokens: int | None = None,
        latency_ms: int | None = None,
    ) -> dict:
        """Construct dictionary representation for UsageRecord row."""
        duration = (
            latency_ms
            if latency_ms is not None
            else int((time.perf_counter() - self.start_mono) * 1000)
        )
        return {
            "request_id": self.request_id,
            "client_id": self.client_id,
            "provider": provider,
            "provider_model": provider_model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "tokens_source": tokens_source,
            "estimated_cost": estimated_cost,
            "cost_status": cost_status,
            "cache_hit": cache_hit,
            "saved_tokens": saved_tokens,
            "latency_ms": duration,
            "status": status,
            "created_at": datetime.now(UTC),
        }
