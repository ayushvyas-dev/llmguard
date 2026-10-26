"""Unit tests for the rate limiter engine and outage fallback behaviors."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.core.errors import GatewayError
from app.ratelimit.limiter import MemoryRateLimiter, RateLimiter


class TestMemoryRateLimiter:
    async def test_sliding_window_allows_up_to_limit(self):
        limiter = MemoryRateLimiter()
        limit = 3
        window = 60
        now = 1000.0

        for i in range(limit):
            res = await limiter.check("client-1", limit=limit, window_seconds=window, now=now + i)
            assert res.allowed is True
            assert res.remaining == limit - i - 1

        # 4th request must be rejected
        res = await limiter.check("client-1", limit=limit, window_seconds=window, now=now + 3)
        assert res.allowed is False
        assert res.remaining == 0
        assert res.retry_after > 0

    async def test_window_rollover_with_time(self):
        limiter = MemoryRateLimiter()
        limit = 2
        window = 10
        now = 1000.0

        # Fill window at t=1000 and t=1002
        res1 = await limiter.check("client-1", limit=limit, window_seconds=window, now=now)
        res2 = await limiter.check("client-1", limit=limit, window_seconds=window, now=now + 2)
        assert res1.allowed and res2.allowed

        # Rejected at t=1005
        res_blocked = await limiter.check(
            "client-1", limit=limit, window_seconds=window, now=now + 5
        )
        assert res_blocked.allowed is False
        assert res_blocked.retry_after == 5  # 1000 + 10 - 1005 = 5

        # At t=1011 (past t=1000 + 10), oldest timestamp evicted, so 1 request admitted
        res_after = await limiter.check(
            "client-1", limit=limit, window_seconds=window, now=now + 11
        )
        assert res_after.allowed is True

    async def test_concurrent_admissions_do_not_overshoot(self):
        limiter = MemoryRateLimiter()
        limit = 10
        window = 60

        async def make_request():
            return await limiter.check("client-concurrent", limit=limit, window_seconds=window)

        # Fire 25 concurrent requests
        results = await asyncio.gather(*(make_request() for _ in range(25)))
        admitted = [r for r in results if r.allowed]
        rejected = [r for r in results if not r.allowed]

        assert len(admitted) == 10
        assert len(rejected) == 15


class TestRateLimiterOutage:
    async def test_redis_none_fail_open(self):
        settings = Settings(rate_limit_fail_mode="open")
        limiter = RateLimiter(settings, redis_client=None)

        res = await limiter.check("client-1", limit=5, window_seconds=60)
        assert res.allowed is True

    async def test_redis_none_fail_closed(self):
        settings = Settings(rate_limit_fail_mode="closed")
        limiter = RateLimiter(settings, redis_client=None)

        with pytest.raises(GatewayError) as exc_info:
            await limiter.check("client-1", limit=5, window_seconds=60)
        assert exc_info.value.status_code == 503
        assert exc_info.value.code == "service_unavailable"

    async def test_redis_error_fail_open_degrades_gracefully(self):
        from unittest.mock import Mock

        settings = Settings(rate_limit_fail_mode="open")
        mock_redis = Mock()
        mock_redis.register_script = Mock(
            return_value=AsyncMock(side_effect=ConnectionError("Redis connection refused"))
        )

        limiter = RateLimiter(settings, redis_client=mock_redis)

        # Should log warning and fall back to in-memory limiter without failing
        res = await limiter.check("client-1", limit=2, window_seconds=60)
        assert res.allowed is True

    async def test_redis_error_fail_closed_returns_503(self):
        from unittest.mock import Mock

        settings = Settings(rate_limit_fail_mode="closed")
        mock_redis = Mock()
        mock_redis.register_script = Mock(
            return_value=AsyncMock(side_effect=ConnectionError("Redis connection refused"))
        )

        limiter = RateLimiter(settings, redis_client=mock_redis)

        with pytest.raises(GatewayError) as exc_info:
            await limiter.check("client-1", limit=2, window_seconds=60)
        assert exc_info.value.status_code == 503
