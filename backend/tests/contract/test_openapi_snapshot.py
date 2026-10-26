"""Contract tests ensuring OpenAPI schema stability and preventing accidental regressions."""

import json
from pathlib import Path

from app.main import create_app

SNAPSHOT_PATH = Path(__file__).parent / "openapi_snapshot.json"


def test_openapi_snapshot_matches():
    """Ensure the FastAPI OpenAPI schema exactly matches the recorded contract snapshot."""
    app = create_app()
    current_spec = app.openapi()

    assert SNAPSHOT_PATH.exists(), f"Snapshot file not found at {SNAPSHOT_PATH}"

    expected_spec = json.loads(SNAPSHOT_PATH.read_text())

    # Check key top-level keys
    assert current_spec.get("openapi") == expected_spec.get("openapi")
    assert current_spec.get("info", {}).get("title") == expected_spec.get("info", {}).get("title")

    # Check paths match exactly
    current_paths = set(current_spec.get("paths", {}).keys())
    expected_paths = set(expected_spec.get("paths", {}).keys())
    assert current_paths == expected_paths, f"Path diff: {current_paths ^ expected_paths}"

    # Critical API routes must always exist
    critical_endpoints = [
        "/api/v1/health",
        "/api/v1/health/ready",
        "/api/v1/chat/completions",
        "/api/v1/admin/traces",
        "/api/v1/admin/clients",
        "/api/v1/admin/policies",
    ]
    for endpoint in critical_endpoints:
        assert endpoint in current_paths, f"Missing critical endpoint: {endpoint}"

    # Detailed path methods check
    for path in expected_paths:
        curr_methods = set(current_spec["paths"][path].keys())
        exp_methods = set(expected_spec["paths"][path].keys())
        assert curr_methods == exp_methods, (
            f"Methods mismatch for {path}: {curr_methods} != {exp_methods}"
        )

    # Full structural comparison
    assert current_spec == expected_spec, "OpenAPI schema has drifted from the snapshot."
