"""Response caching service with Redis and in-process fallback."""

import asyncio
import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

import structlog

from app.schemas.chat import (
    ChatCompletionResponse,
)

logger = structlog.get_logger(__name__)


class CacheBackendError(Exception):
    """Raised when the cache backend fails during retrieval."""


class MemoryCache:
    """Thread-safe / async-safe in-process cache with TTL and fake-clock support."""

    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._store: dict[str, tuple[str, float]] = {}  # key -> (payload, expire_at)
        self._lock = asyncio.Lock()
        self._clock = clock or time.time

    async def get(self, key: str) -> str | None:
        now = self._clock()
        async with self._lock:
            if key not in self._store:
                return None
            val, expire_at = self._store[key]
            if now >= expire_at:
                del self._store[key]
                return None
            return val

    async def set(self, key: str, value: str, ex: int = 3600) -> None:
        now = self._clock()
        expire_at = now + ex
        async with self._lock:
            self._store[key] = (value, expire_at)

    async def delete(self, key: str) -> bool:
        async with self._lock:
            return self._store.pop(key, None) is not None

    async def scan_delete(self, match_prefix: str) -> int:
        deleted = 0
        async with self._lock:
            keys = [k for k in self._store if k.startswith(match_prefix)]
            for k in keys:
                del self._store[k]
                deleted += 1
        return deleted

    async def clear(self) -> None:
        async with self._lock:
            self._store.clear()


class ResponseCacheService:
    """Cache service supporting Redis with graceful error handling and in-memory fallback."""

    def __init__(
        self,
        redis_client=None,
        default_ttl_seconds: int = 3600,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.redis = redis_client
        self.default_ttl = default_ttl_seconds
        self.memory = MemoryCache(clock=clock)
        self._clock = clock or time.time

    async def get(self, key: str) -> dict | None:
        """Fetch cached response dictionary by key.

        Raises CacheBackendError if the underlying Redis client fails.
        """
        if self.redis is not None:
            try:
                raw = await self.redis.get(key)
                if raw is None:
                    return None
                return json.loads(raw)
            except Exception as e:
                logger.error("cache_read_error", key=key, error=str(e))
                raise CacheBackendError(f"Redis get failed: {e}") from e
        else:
            raw = await self.memory.get(key)
            if raw is None:
                return None
            return json.loads(raw)

    async def set(
        self,
        key: str,
        response: ChatCompletionResponse,
        ttl: int | None = None,
    ) -> bool:
        """Store response in cache with TTL. Fails gracefully if backend errors."""
        effective_ttl = ttl or self.default_ttl
        payload = {
            "choices": [c.model_dump() for c in response.choices],
            "usage": response.usage.model_dump() if response.usage else None,
            "cached_at": datetime.now(UTC).isoformat(),
        }
        serialized = json.dumps(payload, ensure_ascii=False)

        if self.redis is not None:
            try:
                await self.redis.set(key, serialized, ex=effective_ttl)
                return True
            except Exception as e:
                logger.warning("cache_write_error", key=key, error=str(e))
                return False
        else:
            await self.memory.set(key, serialized, ex=effective_ttl)
            return True

    async def purge_by_client(self, client_id: UUID | str) -> int:
        """Invalidate all cached responses for a client (admin operation)."""
        pattern = "llmguard:cache:v1:*"
        # If in-memory:
        count = await self.memory.scan_delete("llmguard:cache:v1:")
        if self.redis is not None:
            try:
                cursor = 0
                while True:
                    cursor, keys = await self.redis.scan(cursor=cursor, match=pattern, count=100)
                    if keys:
                        # Inspect or delete
                        await self.redis.delete(*keys)
                        count += len(keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.warning("cache_purge_error", client_id=str(client_id), error=str(e))
        return count
