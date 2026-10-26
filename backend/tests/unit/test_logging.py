from app.observability.logging import redact


def test_log_redaction_removes_authorization_and_gateway_keys() -> None:
    event = redact(None, "event", {"authorization": "Bearer secret", "message": "lg_dev_abc123"})
    assert event == {"authorization": "[REDACTED]", "message": "[REDACTED]"}
