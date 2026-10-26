"""Tests for deadline budgeting, backoff with full jitter, and Hypothesis property tests."""

import random

from hypothesis import given
from hypothesis import strategies as st

from app.routing.budget import DeadlineBudget, calculate_backoff_delay


class TestBackoffWithJitter:
    def test_backoff_within_jitter_bounds(self) -> None:
        base = 0.5
        max_sec = 10.0

        for attempt in range(5):
            ceiling = min(max_sec, base * (2**attempt))
            for seed in range(20):
                rng = random.Random(seed)
                delay = calculate_backoff_delay(
                    attempt,
                    base_seconds=base,
                    max_seconds=max_sec,
                    rng=rng,
                )
                assert 0.0 <= delay <= ceiling

    def test_retry_after_honored_and_capped(self) -> None:
        base = 0.5
        max_sec = 10.0
        cap = 25.0

        # Normal retry_after within cap
        delay = calculate_backoff_delay(
            attempt=1,
            base_seconds=base,
            max_seconds=max_sec,
            retry_after=5.0,
            retry_after_cap=cap,
        )
        assert delay >= 5.0

        # Excessively large retry_after capped
        delay_capped = calculate_backoff_delay(
            attempt=1,
            base_seconds=base,
            max_seconds=max_sec,
            retry_after=100.0,
            retry_after_cap=cap,
        )
        assert delay_capped == cap


class TestDeadlineBudget:
    def test_budget_shrinks_and_stops(self) -> None:
        current_time = 100.0

        def fake_clock() -> float:
            return current_time

        budget = DeadlineBudget(
            overall_deadline_seconds=20.0,
            per_attempt_timeout_seconds=8.0,
            clock=fake_clock,
        )

        assert budget.has_budget() is True
        assert budget.remaining() == 20.0
        assert budget.timeout_for_attempt() == 8.0  # min(8, 20)

        # Advance 15 seconds: 5s remaining
        current_time += 15.0
        assert budget.remaining() == 5.0
        assert budget.timeout_for_attempt() == 5.0  # min(8, 5) = 5
        assert budget.has_budget() is True

        # Advance 6 seconds: 0s remaining
        current_time += 6.0
        assert budget.remaining() == 0.0
        assert budget.has_budget() is False
        assert budget.timeout_for_attempt() == 0.0

    @given(
        overall_deadline=st.floats(min_value=1.0, max_value=60.0),
        per_attempt_timeout=st.floats(min_value=0.5, max_value=15.0),
        latencies=st.lists(st.floats(min_value=0.1, max_value=20.0), min_size=1, max_size=10),
    )
    def test_property_attempts_bounded_by_deadline(
        self,
        overall_deadline: float,
        per_attempt_timeout: float,
        latencies: list[float],
    ) -> None:
        """Property test: No sequence of attempts can ever consume more than overall deadline."""
        simulated_time = 0.0

        def fake_clock() -> float:
            return simulated_time

        budget = DeadlineBudget(
            overall_deadline_seconds=overall_deadline,
            per_attempt_timeout_seconds=per_attempt_timeout,
            clock=fake_clock,
        )

        total_consumed = 0.0
        for lat in latencies:
            if not budget.has_budget():
                break
            attempt_timeout = budget.timeout_for_attempt()
            actual_duration = min(lat, attempt_timeout)
            simulated_time += actual_duration
            total_consumed += actual_duration

        assert total_consumed <= overall_deadline + 1e-6
