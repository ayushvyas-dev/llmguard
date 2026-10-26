"""Unit tests for ResponseCacheService (CACHE-004, CACHE-009)."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.cache.service import CacheBackendError, ResponseCacheService
from app.schemas.chat import (
    AssistantMessage,
    ChatCompletionResponse,
    Choice,
    GatewayResponse,
    Usage,
)


def make_dummy_response(text: str = "Cached hello") -> ChatCompletionResponse:
    return ChatCompletionResponse(
        id="chatcmpl-test",
        created=1000,
        model="fake-chat",
        provider="fake",
        provider_model="fake-chat",
        choices=[Choice(message=AssistantMessage(content=text))],
        usage=Usage(
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            tokens_source="provider",
            estimated_cost_usd=0.0001,
            cost_is_estimate=True,
        ),
        gateway=GatewayResponse(request_id="r1", correlation_id="c1", latency_ms=10),
    )


@pytest.mark.asyncio
async def test_cache_get_and_set_in_memory():
    svc = ResponseCacheService(redis_client=None, default_ttl_seconds=300)
    resp = make_dummy_response("Hello from cache")
    key = "llmguard:cache:v1:test1"

    # Initially missing
    assert await svc.get(key) is None

    # Set and get
    ok = await svc.set(key, resp, ttl=60)
    assert ok is True

    cached = await svc.get(key)
    assert cached is not None
    assert cached["choices"][0]["message"]["content"] == "Hello from cache"
    assert cached["usage"]["total_tokens"] == 15


@pytest.mark.asyncio
async def test_ttl_expiry_with_fake_clock():
    current_time = 1000.0

    def fake_clock() -> float:
        return current_time

    svc = ResponseCacheService(redis_client=None, clock=fake_clock)
    resp = make_dummy_response()
    key = "llmguard:cache:v1:expiring_key"

    # Set with 10 second TTL
    await svc.set(key, resp, ttl=10)

    # At 1005s (within TTL): hit
    current_time = 1005.0
    assert await svc.get(key) is not None

    # At 1010.1s (past TTL): miss
    current_time = 1010.1
    assert await svc.get(key) is None


@pytest.mark.asyncio
async def test_redis_failure_raises_cache_backend_error_on_get():
    mock_redis = MagicMock()
    mock_redis.get = AsyncMock(side_effect=ConnectionError("Redis connection refused"))

    svc = ResponseCacheService(redis_client=mock_redis)

    with pytest.raises(CacheBackendError) as exc_info:
        await svc.get("llmguard:cache:v1:key_fail")

    assert "Redis get failed" in str(exc_info.value)


@pytest.mark.asyncio
async def test_redis_failure_on_set_is_non_fatal():
    mock_redis = MagicMock()
    mock_redis.set = AsyncMock(side_effect=TimeoutError("Redis timeout"))

    svc = ResponseCacheService(redis_client=mock_redis)
    resp = make_dummy_response()

    # set should catch exception, log warning, and return False without raising
    ok = await svc.set("llmguard:cache:v1:key_fail", resp)
    assert ok is False


@pytest.mark.asyncio
async def test_purge_by_client():
    svc = ResponseCacheService(redis_client=None)
    resp = make_dummy_response()
    key1 = "llmguard:cache:v1:aaa"
    key2 = "llmguard:cache:v1:bbb"

    await svc.set(key1, resp)
    await svc.set(key2, resp)

    assert await svc.get(key1) is not None
    assert await svc.get(key2) is not None

    deleted = await svc.purge_by_client(uuid4())
    assert deleted >= 2

    assert await svc.get(key1) is None
    assert await svc.get(key2) is None
