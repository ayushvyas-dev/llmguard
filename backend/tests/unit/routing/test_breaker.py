"""Unit tests for circuit breaker state transitions (closed, open, half-open)."""

from app.routing.breaker import CircuitBreaker, CircuitState


class TestCircuitBreaker:
    async def test_circuit_state_transitions_with_fake_clock(self) -> None:
        current_time = 1000.0

        def fake_clock() -> float:
            return current_time

        breaker = CircuitBreaker(
            failure_threshold=3,
            recovery_seconds=30.0,
            clock=fake_clock,
        )

        provider = "test-prov"
        model = "test-model"

        # 1. Initially CLOSED
        assert await breaker.get_state(provider, model) == CircuitState.CLOSED
        assert await breaker.can_attempt(provider, model) is True

        # 2. 2 failures: still CLOSED
        await breaker.record_failure(provider, model)
        await breaker.record_failure(provider, model)
        assert await breaker.get_state(provider, model) == CircuitState.CLOSED
        assert await breaker.can_attempt(provider, model) is True

        # 3. 3rd failure: transitions to OPEN
        await breaker.record_failure(provider, model)
        assert await breaker.get_state(provider, model) == CircuitState.OPEN
        assert await breaker.can_attempt(provider, model) is False

        # 4. Advance time by 20s (less than 30s recovery): still OPEN
        current_time += 20.0
        assert await breaker.get_state(provider, model) == CircuitState.OPEN
        assert await breaker.can_attempt(provider, model) is False

        # 5. Advance time past 30s recovery (e.g. +15s -> total 35s): transitions to HALF_OPEN
        current_time += 15.0
        assert await breaker.get_state(provider, model) == CircuitState.HALF_OPEN
        assert await breaker.can_attempt(provider, model) is True

        # 6. Failure in HALF_OPEN transitions immediately back to OPEN
        await breaker.record_failure(provider, model)
        assert await breaker.get_state(provider, model) == CircuitState.OPEN
        assert await breaker.can_attempt(provider, model) is False

        # 7. Advance time again past recovery -> HALF_OPEN
        current_time += 35.0
        assert await breaker.get_state(provider, model) == CircuitState.HALF_OPEN

        # 8. Success in HALF_OPEN transitions to CLOSED and resets failures
        await breaker.record_success(provider, model)
        assert await breaker.get_state(provider, model) == CircuitState.CLOSED
        assert await breaker.can_attempt(provider, model) is True
