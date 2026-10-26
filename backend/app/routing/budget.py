"""Deadline budget and backoff calculation with full jitter."""

import random
import time
from collections.abc import Callable


class DeadlineBudget:
    """Tracks deadline budget across retries and fallbacks."""

    def __init__(
        self,
        overall_deadline_seconds: float,
        per_attempt_timeout_seconds: float,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.clock = clock or time.time
        self.start_time = self.clock()
        self.overall_deadline = overall_deadline_seconds
        self.per_attempt_timeout = per_attempt_timeout_seconds

    def elapsed(self) -> float:
        return self.clock() - self.start_time

    def remaining(self) -> float:
        return max(0.0, self.overall_deadline - self.elapsed())

    def timeout_for_attempt(self) -> float:
        return min(self.per_attempt_timeout, self.remaining())

    def has_budget(self) -> bool:
        return self.remaining() > 0


def calculate_backoff_delay(
    attempt: int,
    base_seconds: float = 0.5,
    max_seconds: float = 10.0,
    retry_after: float | None = None,
    retry_after_cap: float = 30.0,
    rng: random.Random | None = None,
) -> float:
    """Calculate exponential backoff with full jitter and Retry-After handling.

    Formula: delay = random.uniform(0, min(max_seconds, base_seconds * 2^attempt))
    If retry_after is provided, delay is at least retry_after up to retry_after_cap.
    """
    ceiling = min(max_seconds, base_seconds * (2**attempt))
    jitter_gen = rng if rng is not None else random
    delay = jitter_gen.uniform(0.0, ceiling)

    if retry_after is not None:
        delay = min(retry_after_cap, max(delay, float(retry_after)))

    return delay
