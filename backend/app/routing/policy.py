"""Routing policy configuration model and resolution."""

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings


class RoutingPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    primary: str | None = None
    fallbacks: list[str] = Field(default_factory=list)
    allow_fallback: bool = True
    per_attempt_timeout_seconds: float = Field(default=35.0, gt=0)
    request_deadline_seconds: float = Field(default=60.0, gt=0)
    max_retries: int = Field(default=2, ge=0)
    backoff_base_seconds: float = Field(default=0.5, gt=0)
    backoff_max_seconds: float = Field(default=10.0, gt=0)
    retry_after_cap_seconds: float = Field(default=30.0, gt=0)


def resolve_routing_policy(
    policy_config: dict | None = None,
    settings: Settings | None = None,
) -> RoutingPolicy:
    """Resolve a routing policy from a DB configuration dict or fall back to system defaults."""
    s = settings or Settings()
    defaults = {
        "primary": None,
        "fallbacks": [],
        "allow_fallback": True,
        "per_attempt_timeout_seconds": s.per_attempt_timeout_seconds,
        "request_deadline_seconds": s.request_deadline_seconds,
        "max_retries": s.max_retries,
        "backoff_base_seconds": s.backoff_base_seconds,
        "backoff_max_seconds": s.backoff_max_seconds,
        "retry_after_cap_seconds": s.retry_after_cap_seconds,
    }
    if policy_config:
        merged = {**defaults, **policy_config}
        return RoutingPolicy.model_validate(merged)

    return RoutingPolicy(**defaults)
