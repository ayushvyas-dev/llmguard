"""Unit tests for TraceRecorder event ordering, bounds, and content storage controls."""

import hashlib
from uuid import uuid4

from app.observability.recorder import TraceRecorder


def test_event_ordering_and_defaults() -> None:
    req_id = "req_123"
    corr_id = "corr_456"
    client_id = uuid4()
    recorder = TraceRecorder(
        request_id=req_id,
        correlation_id=corr_id,
        client_id=client_id,
        store_content=False,
    )

    recorder.record_event("request_received")
    recorder.record_event("auth", outcome="ok")
    recorder.record_event("rate_limit", outcome="ok")
    recorder.record_event("validation", outcome="ok")
    recorder.record_event("security_input", duration_ms=5, outcome="ok")
    recorder.record_event("route_select", outcome="ok")
    recorder.record_event("provider_attempt", duration_ms=45, outcome="ok")
    recorder.record_event("security_output", duration_ms=2, outcome="ok")
    recorder.record_event("usage_recorded", outcome="ok")
    recorder.record_event("response_sent", outcome="success")

    assert len(recorder.events) == 10
    names = [e["name"] for e in recorder.events]
    assert names == [
        "request_received",
        "auth",
        "rate_limit",
        "validation",
        "security_input",
        "route_select",
        "provider_attempt",
        "security_output",
        "usage_recorded",
        "response_sent",
    ]


def test_default_trace_contains_no_raw_prompt_text() -> None:
    secret_prompt = "My super confidential prompt text"
    recorder = TraceRecorder(
        request_id="req_test",
        correlation_id="corr_test",
        store_content=False,  # default is False
    )

    trace = recorder.build_trace(
        status="success",
        http_status=200,
        prompt_text=secret_prompt,
        output_text="Model response",
    )

    # Prompt text must NOT be in content_preview or trace fields
    assert trace["content_preview"] is None
    assert trace["content_expires_at"] is None
    # Only hash and length are stored
    assert trace["input_chars"] == len(secret_prompt)
    assert trace["prompt_hash"] == hashlib.sha256(secret_prompt.encode("utf-8")).hexdigest()
    assert secret_prompt not in str(trace["content_preview"])


def test_opt_in_content_storage_stores_preview_with_expiry() -> None:
    redacted_prompt = "Email me at [EMAIL_ADDRESS]"
    redacted_output = "Response text"
    recorder = TraceRecorder(
        request_id="req_test",
        correlation_id="corr_test",
        store_content=True,
        content_retention_days=7,
    )

    trace = recorder.build_trace(
        status="success",
        http_status=200,
        prompt_text=redacted_prompt,
        output_text=redacted_output,
    )

    assert trace["content_preview"] is not None
    assert trace["content_preview"]["prompt"] == redacted_prompt
    assert trace["content_preview"]["output"] == redacted_output
    assert trace["content_expires_at"] is not None


def test_event_bounds_and_truncation() -> None:
    recorder = TraceRecorder(
        request_id="req_overflow",
        correlation_id="corr_overflow",
        max_events=5,
    )

    for i in range(10):
        recorder.record_event(f"event_{i}")

    # Maximum 5 events + 1 truncation marker
    assert len(recorder.events) == 6
    assert recorder.events[-1]["name"] == "truncated"
    assert recorder.events[-1]["attributes"]["reason"] == "max_events_exceeded"
