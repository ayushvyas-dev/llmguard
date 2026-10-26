"""Provider health metrics tracking rolling success rates, latencies, and error categories."""

import asyncio
from dataclasses import dataclass, field


@dataclass
class ModelHealthStats:
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_latency_ms: int = 0
    error_counts: dict[str, int] = field(default_factory=dict)

    @property
    def success_rate(self) -> float:
        if self.total_requests == 0:
            return 1.0
        return self.successful_requests / self.total_requests

    @property
    def avg_latency_ms(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.total_latency_ms / self.total_requests


class ProviderHealthTracker:
    """In-memory tracker for provider/model health metrics."""

    def __init__(self) -> None:
        self._stats: dict[str, ModelHealthStats] = {}
        self._lock = asyncio.Lock()

    def _key(self, provider: str, model: str) -> str:
        return f"{provider}:{model}"

    async def record(
        self,
        provider: str,
        model: str,
        latency_ms: int,
        success: bool,
        error_code: str | None = None,
    ) -> None:
        key = self._key(provider, model)
        async with self._lock:
            stats = self._stats.setdefault(key, ModelHealthStats())
            stats.total_requests += 1
            stats.total_latency_ms += latency_ms
            if success:
                stats.successful_requests += 1
            else:
                stats.failed_requests += 1
                if error_code:
                    stats.error_counts[error_code] = stats.error_counts.get(error_code, 0) + 1

    async def get_metrics(self) -> dict[str, dict]:
        async with self._lock:
            result = {}
            for key, stats in self._stats.items():
                provider, model = key.split(":", 1)
                prov_dict = result.setdefault(provider, {})
                prov_dict[model] = {
                    "total_requests": stats.total_requests,
                    "successful_requests": stats.successful_requests,
                    "failed_requests": stats.failed_requests,
                    "success_rate": round(stats.success_rate, 4),
                    "avg_latency_ms": round(stats.avg_latency_ms, 2),
                    "error_counts": dict(stats.error_counts),
                }
            return result
