"""Circuit breaker for provider models with closed, open, and half-open states."""

import asyncio
import time
from collections.abc import Callable
from enum import StrEnum

import structlog

logger = structlog.get_logger(__name__)


class CircuitState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """In-process and Redis-backed circuit breaker per (provider, model)."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_seconds: float = 30.0,
        clock: Callable[[], float] | None = None,
        redis_client=None,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self.clock = clock or time.time
        self.redis = redis_client
        self._lock = asyncio.Lock()
        # In-process state: key -> {"state": CircuitState, "failures": int, "opened_at": float}
        self._state: dict[str, dict] = {}

    def _key(self, provider: str, model: str) -> str:
        return f"{provider}:{model}"

    async def get_state(self, provider: str, model: str) -> CircuitState:
        key = self._key(provider, model)
        now = self.clock()

        async with self._lock:
            info = self._state.get(key)
            if info is None:
                return CircuitState.CLOSED

            state = info["state"]
            if state == CircuitState.OPEN:
                if now - info["opened_at"] >= self.recovery_seconds:
                    info["state"] = CircuitState.HALF_OPEN
                    logger.info("circuit_breaker_half_open", provider=provider, model=model)
                    return CircuitState.HALF_OPEN
                return CircuitState.OPEN

            return state

    async def get_all_states(self) -> dict[str, str]:
        """Return dict of provider:model -> circuit_state string."""
        now = self.clock()
        async with self._lock:
            result = {}
            for key, info in self._state.items():
                state = info["state"]
                if state == CircuitState.OPEN and now - info["opened_at"] >= self.recovery_seconds:
                    state = CircuitState.HALF_OPEN
                result[key] = state.value
            return result

    async def can_attempt(self, provider: str, model: str) -> bool:
        """Return True if an attempt is allowed; False if circuit is OPEN."""
        state = await self.get_state(provider, model)
        return state in (CircuitState.CLOSED, CircuitState.HALF_OPEN)

    async def record_success(self, provider: str, model: str) -> None:
        """Record successful call, closing the circuit if it was half-open."""
        key = self._key(provider, model)
        async with self._lock:
            info = self._state.setdefault(
                key, {"state": CircuitState.CLOSED, "failures": 0, "opened_at": 0.0}
            )
            if info["state"] == CircuitState.HALF_OPEN:
                logger.info("circuit_breaker_closed", provider=provider, model=model)
            info["state"] = CircuitState.CLOSED
            info["failures"] = 0

    async def record_failure(self, provider: str, model: str) -> None:
        """Record failure, potentially opening the circuit."""
        key = self._key(provider, model)
        now = self.clock()
        async with self._lock:
            info = self._state.setdefault(
                key, {"state": CircuitState.CLOSED, "failures": 0, "opened_at": 0.0}
            )
            info["failures"] += 1
            tripped = (
                info["state"] == CircuitState.HALF_OPEN
                or info["failures"] >= self.failure_threshold
            )
            if tripped:
                info["state"] = CircuitState.OPEN
                info["opened_at"] = now
                logger.warning(
                    "circuit_breaker_opened",
                    provider=provider,
                    model=model,
                    failures=info["failures"],
                )
