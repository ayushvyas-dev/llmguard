"""Pydantic schemas for Admin API and Client/Key management."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import ClientStatus, KeyRole, KeyStatus


class ClientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    status: ClientStatus = ClientStatus.ACTIVE
    security_policy_id: UUID | None = None
    routing_policy_id: UUID | None = None
    rate_limit_rpm: int | None = Field(default=None, gt=0)
    window_seconds: int | None = Field(default=None, gt=0)
    daily_token_quota: int | None = Field(default=None, gt=0)
    monthly_cost_quota: Decimal | None = Field(default=None, ge=0)
    allowed_models: list[str] | None = None
    store_content: bool = False


class ClientUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: ClientStatus | None = None
    security_policy_id: UUID | None = None
    routing_policy_id: UUID | None = None
    rate_limit_rpm: int | None = Field(default=None, gt=0)
    window_seconds: int | None = Field(default=None, gt=0)
    daily_token_quota: int | None = Field(default=None, gt=0)
    monthly_cost_quota: Decimal | None = Field(default=None, ge=0)
    allowed_models: list[str] | None = None
    store_content: bool | None = None


class ClientResponse(BaseModel):
    id: UUID
    name: str
    status: ClientStatus
    security_policy_id: UUID | None = None
    routing_policy_id: UUID | None = None
    rate_limit_rpm: int | None = None
    window_seconds: int | None = None
    daily_token_quota: int | None = None
    monthly_cost_quota: Decimal | None = None
    allowed_models: list[str] | None = None
    store_content: bool
    created_at: datetime
    updated_at: datetime


class KeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: KeyRole = KeyRole.CLIENT
    expires_in_days: int | None = Field(default=None, gt=0)
    label: str | None = Field(default=None, max_length=255)


class KeyResponse(BaseModel):
    id: UUID
    client_id: UUID
    prefix: str
    role: KeyRole
    status: KeyStatus
    label: str | None = None
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    created_at: datetime | None = None


class KeyCreatedResponse(KeyResponse):
    key: str  # The full secret token, returned ONCE at creation


class SecurityPolicyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    config: dict
    is_default: bool = False


class SecurityPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: dict
    is_default: bool | None = None


class SecurityPolicyResponse(BaseModel):
    id: UUID
    name: str
    version: int
    config: dict
    is_default: bool
    created_by: str | None = None
    created_at: datetime


class RoutingPolicyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    config: dict
    is_default: bool = False


class RoutingPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config: dict
    is_default: bool | None = None


class RoutingPolicyResponse(BaseModel):
    id: UUID
    name: str
    version: int
    config: dict
    is_default: bool
    created_by: str | None = None
    created_at: datetime
