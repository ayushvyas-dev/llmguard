from enum import StrEnum
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class AppEnv(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: AppEnv = AppEnv.DEVELOPMENT
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "INFO"
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    database_url: str = "postgresql+psycopg://llmguard:llmguard@localhost:5432/llmguard"
    database_url_direct: str = "postgresql+psycopg://llmguard:llmguard@localhost:5432/llmguard"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True
    api_key_pepper: str | None = None
    request_max_body_bytes: int = Field(default=1_048_576, gt=0)
    request_max_messages: int = Field(default=50, gt=0)
    request_max_message_chars: int = Field(default=20_000, gt=0)
    request_max_tokens: int = Field(default=4_096, gt=0)
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    providers_enabled: str = "fake,groq,gemini"
    unsupported_parameter_mode: Literal["strict", "lenient"] = "strict"
    request_max_tool_schema_bytes: int = Field(default=16_384, gt=0)
    request_max_tool_argument_bytes: int = Field(default=8_192, gt=0)
    default_rate_limit_rpm: int = Field(default=30, gt=0)
    default_rate_limit_window_seconds: int = Field(default=60, gt=0)
    rate_limit_fail_mode: Literal["open", "closed"] = "open"
    request_deadline_seconds: float = Field(default=60.0, gt=0)
    per_attempt_timeout_seconds: float = Field(default=35.0, gt=0)
    max_retries: int = Field(default=2, ge=0)
    backoff_base_seconds: float = Field(default=0.5, gt=0)
    backoff_max_seconds: float = Field(default=10.0, gt=0)
    retry_after_cap_seconds: float = Field(default=30.0, gt=0)
    circuit_breaker_failure_threshold: int = Field(default=5, gt=0)
    circuit_breaker_recovery_seconds: float = Field(default=30.0, gt=0)
    trace_max_events: int = Field(default=100, gt=0)
    trace_max_bytes: int = Field(default=65_536, gt=0)
    content_storage_retention_days: int = Field(default=7, gt=0)
    trace_retention_days: int = Field(default=30, gt=0)
    security_event_retention_days: int = Field(default=90, gt=0)
    usage_retention_days: int = Field(default=365, gt=0)
    audit_mode: Literal["async", "sync"] = "async"
    trace_queue_size: int = Field(default=1000, gt=0)
    cache_enabled: bool = True
    cache_ttl_seconds: int = Field(default=3600, gt=0)
    cache_schema_version: int = Field(default=1, gt=0)
    routing_version: int = Field(default=1, gt=0)
    demo_mode: bool = False
    demo_admin_key: str = "lga_dev_demo0000_recruiter_demo_access_key"

    @field_validator("database_url", "database_url_direct", "redis_url", mode="before")
    @classmethod
    def clean_connection_urls(cls, value: str) -> str:
        if isinstance(value, str):
            return value.strip().strip("'\"")
        return value

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_allowed_origins(cls, value: str | list[str]) -> list[str] | str:
        if isinstance(value, str) and not value.lstrip().startswith("["):
            return [origin.strip().strip("'\"") for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        if self.app_env is AppEnv.PRODUCTION:
            if not self.api_key_pepper or len(self.api_key_pepper) < 32:
                raise ValueError("API_KEY_PEPPER must be at least 32 characters in production")
            if "*" in self.allowed_origins:
                raise ValueError("ALLOWED_ORIGINS cannot contain '*' in production")
        return self


def get_settings() -> Settings:
    return Settings()
