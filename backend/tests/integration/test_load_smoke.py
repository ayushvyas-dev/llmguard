"""Smoke test for load testing runner (B8, NFR-005, NFR-013)."""

import pytest

from tests.load.run_load_test import run_concurrency_profile, setup_test_app


@pytest.mark.asyncio
async def test_load_test_concurrency_smoke():
    """Verify that concurrent requests complete successfully without failures."""
    app, engine, token = await setup_test_app()
    try:
        profile = await run_concurrency_profile(app, token, concurrency=5, total_requests=10)
        assert profile["total_requests"] == 10
        assert profile["successful_requests"] == 10
        assert profile["failed_requests"] == 0
        assert profile["error_rate"] == 0.0
        assert profile["rps"] > 0
        assert profile["p50_ms"] > 0
    finally:
        await engine.dispose()
