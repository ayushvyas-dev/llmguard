from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import utc_now
from app.db.base import Base

JSONType = JSON().with_variant(JSONB, "postgresql")
TextArray = JSON().with_variant(ARRAY(String), "postgresql")


class ClientStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class KeyRole(StrEnum):
    CLIENT = "client"
    ADMIN = "admin"


class KeyStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


class Provider(StrEnum):
    GROQ = "groq"
    GEMINI = "gemini"


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    status: Mapped[ClientStatus] = mapped_column(
        Enum(ClientStatus, values_callable=lambda enum: [item.value for item in enum]),
        default=ClientStatus.ACTIVE,
        index=True,
    )
    security_policy_id: Mapped[UUID | None] = mapped_column(ForeignKey("security_policies.id"))
    routing_policy_id: Mapped[UUID | None] = mapped_column(ForeignKey("routing_policies.id"))
    rate_limit_rpm: Mapped[int | None] = mapped_column(Integer)
    window_seconds: Mapped[int | None] = mapped_column(Integer)
    daily_token_quota: Mapped[int | None] = mapped_column(BigInteger)
    monthly_cost_quota: Mapped[Decimal | None] = mapped_column(Numeric)
    allowed_models: Mapped[list[str] | None] = mapped_column(TextArray)
    store_content: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ApiKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (Index("ix_api_keys_client_status", "client_id", "status"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    client_id: Mapped[UUID] = mapped_column(ForeignKey("clients.id"))
    prefix: Mapped[str] = mapped_column(String(255), unique=True)
    key_hash: Mapped[bytes] = mapped_column(LargeBinary)
    role: Mapped[KeyRole] = mapped_column(
        Enum(KeyRole, values_callable=lambda enum: [item.value for item in enum])
    )
    status: Mapped[KeyStatus] = mapped_column(
        Enum(KeyStatus, values_callable=lambda enum: [item.value for item in enum]),
        default=KeyStatus.ACTIVE,
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    label: Mapped[str | None] = mapped_column(String(255))


class PolicyColumns:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255))
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict] = mapped_column(JSONType)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SecurityPolicy(PolicyColumns, Base):
    __tablename__ = "security_policies"
    __table_args__ = (
        UniqueConstraint("name", "version", name="uq_security_policies_name_version"),
    )


class RoutingPolicy(PolicyColumns, Base):
    __tablename__ = "routing_policies"
    __table_args__ = (UniqueConstraint("name", "version", name="uq_routing_policies_name_version"),)


class ProviderModel(Base):
    __tablename__ = "provider_models"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    alias: Mapped[str] = mapped_column(String(255), unique=True)
    provider: Mapped[Provider] = mapped_column(
        Enum(Provider, values_callable=lambda enum: [item.value for item in enum])
    )
    provider_model_id: Mapped[str] = mapped_column(String(255))
    capabilities: Mapped[dict] = mapped_column(JSONType)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Pricing(Base):
    __tablename__ = "pricing"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    provider: Mapped[str] = mapped_column(String(255))
    provider_model_id: Mapped[str] = mapped_column(String(255))
    input_price_per_mtok: Mapped[Decimal | None] = mapped_column(Numeric)
    output_price_per_mtok: Mapped[Decimal | None] = mapped_column(Numeric)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source_note: Mapped[str | None] = mapped_column(Text)


class SecurityEvent(Base):
    __tablename__ = "security_events"
    __table_args__ = (
        Index("ix_security_events_created_at", "created_at"),
        Index("ix_security_events_client_created", "client_id", "created_at"),
        Index("ix_security_events_category_action_created", "category", "action", "created_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    request_id: Mapped[str | None] = mapped_column(String(128))
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id"))
    direction: Mapped[str] = mapped_column(String(16))
    category: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))
    detector: Mapped[str] = mapped_column(String(128))
    score: Mapped[float] = mapped_column()
    reason_codes: Mapped[list[str]] = mapped_column(TextArray)
    policy_version: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_created_at", "created_at"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(128))
    target_type: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[str] = mapped_column(String(255))
    summary: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RequestTrace(Base):
    __tablename__ = "request_traces"
    __table_args__ = (
        Index("ix_request_traces_client_started", "client_id", "started_at"),
        Index("ix_request_traces_status_started", "status", "started_at"),
        Index("ix_request_traces_correlation_id", "correlation_id"),
        Index("ix_request_traces_started_at", "started_at"),
    )
    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    correlation_id: Mapped[str] = mapped_column(String(128))
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    status: Mapped[str] = mapped_column(String(32))
    http_status: Mapped[int] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(64))
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_model: Mapped[str | None] = mapped_column(String(255))
    fallback_used: Mapped[bool] = mapped_column(Boolean, default=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    security_decision: Mapped[str | None] = mapped_column(String(32))
    risk_score: Mapped[float | None] = mapped_column(Float)
    policy_version: Mapped[int | None] = mapped_column(Integer)
    cache_status: Mapped[str | None] = mapped_column(String(32))
    prompt_hash: Mapped[str | None] = mapped_column(String(64))
    input_chars: Mapped[int] = mapped_column(Integer, default=0)
    output_chars: Mapped[int] = mapped_column(Integer, default=0)
    events: Mapped[list[dict]] = mapped_column(JSONType, default=list)
    content_preview: Mapped[dict | None] = mapped_column(JSONType)
    content_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UsageRecord(Base):
    __tablename__ = "usage_records"
    __table_args__ = (
        Index("ix_usage_records_client_created", "client_id", "created_at"),
        Index(
            "ix_usage_records_provider_model_created",
            "provider",
            "provider_model",
            "created_at",
        ),
        Index("ix_usage_records_created_at", "created_at"),
    )
    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id"))
    provider: Mapped[str | None] = mapped_column(String(64))
    provider_model: Mapped[str | None] = mapped_column(String(255))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    tokens_source: Mapped[str] = mapped_column(String(32))
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    cost_status: Mapped[str] = mapped_column(String(32))
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    saved_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
