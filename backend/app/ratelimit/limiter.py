"""Rate limiting engine with Redis Lua atomic sliding-window and in-process fallback."""

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass

import structlog

from app.core.config import Settings
from app.core.errors import GatewayError

logger = structlog.get_logger(__name__)

SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clear_before = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)
local current_requests = redis.call('ZCARD', key)
if current_requests < limit then
    redis.call('ZADD', key, now, now .. ':' .. redis.call('INCR', key .. ':seq'))
    redis.call('EXPIRE', key, window + 1)
    return {1, limit - current_requests - 1, window}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = 1
    if #oldest > 0 then
        retry_after = math.max(1, math.ceil(tonumber(oldest[2]) + window - now))
    end
    return {0, 0, retry_after}
end
"""


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int
    retry_after: int


class MemoryRateLimiter:
    """Thread-safe / async-safe in-process sliding-window rate limiter."""

    def __init__(self) -> None:
        self._windows: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def check(
        self,
        key: str,
        limit: int,
        window_seconds: int,
        now: float | None = None,
    ) -> RateLimitResult:
        now_ts = now if now is not None else time.time()
        clear_before = now_ts - window_seconds

        async with self._lock:
            q = self._windows.setdefault(key, deque())
            # Evict expired timestamps
            while q and q[0] <= clear_before:
                q.popleft()

            if len(q) < limit:
                q.append(now_ts)
                remaining = limit - len(q)
                return RateLimitResult(
                    allowed=True,
                    limit=limit,
                    remaining=remaining,
                    reset_seconds=window_seconds,
                    retry_after=0,
                )
            else:
                oldest = q[0]
                retry_after = max(1, math.ceil(oldest + window_seconds - now_ts))
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_seconds=retry_after,
                    retry_after=retry_after,
                )


class RateLimiter:
    """Main rate limiter coordinating Redis sliding window with in-memory degradation fallback."""

    def __init__(
        self,
        settings: Settings,
        redis_client=None,
    ) -> None:
        self.settings = settings
        self.redis = redis_client
        self.memory_fallback = MemoryRateLimiter()
        self._script = None

    async def check(
        self,
        client_id: str,
        limit: int | None = None,
        window_seconds: int | None = None,
        now: float | None = None,
    ) -> RateLimitResult:
        limit_val = limit if limit is not None else self.settings.default_rate_limit_rpm
        window_val = (
            window_seconds
            if window_seconds is not None
            else self.settings.default_rate_limit_window_seconds
        )
        current_now = now if now is not None else time.time()

        if self.redis is not None:
            try:
                redis_key = f"rl:{client_id}"
                if self._script is None:
                    self._script = self.redis.register_script(SLIDING_WINDOW_LUA)
                # Run Lua script
                res = await self._script(
                    keys=[redis_key],
                    args=[str(current_now), str(window_val), str(limit_val)],
                )
                allowed = bool(res[0] == 1)
                remaining = int(res[1])
                retry_or_reset = int(res[2])
                return RateLimitResult(
                    allowed=allowed,
                    limit=limit_val,
                    remaining=remaining,
                    reset_seconds=retry_or_reset,
                    retry_after=retry_or_reset if not allowed else 0,
                )
            except Exception as exc:
                logger.warning(
                    "redis_ratelimiter_failure_degraded",
                    client_id=client_id,
                    error=str(exc),
                    fail_mode=self.settings.rate_limit_fail_mode,
                )
                if self.settings.rate_limit_fail_mode == "closed":
                    raise GatewayError(
                        status_code=503,
                        code="service_unavailable",
                        message="Rate limiting service unavailable.",
                        error_type="server_error",
                    ) from exc
                # Otherwise fall back to in-process memory limiter
                return await self.memory_fallback.check(
                    client_id, limit_val, window_val, now=current_now
                )

        # Redis is not configured/available
        if self.settings.rate_limit_fail_mode == "closed":
            raise GatewayError(
                status_code=503,
                code="service_unavailable",
                message="Rate limiting service unavailable.",
                error_type="server_error",
            )
        return await self.memory_fallback.check(client_id, limit_val, window_val, now=current_now)
