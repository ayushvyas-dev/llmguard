"""B6 request traces and usage records.

Revision ID: 0004_b6
Revises: 0003_b4
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004_b6"
down_revision = "0003_b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. request_traces
    op.create_table(
        "request_traces",
        sa.Column("request_id", sa.String(128), primary_key=True),
        sa.Column("correlation_id", sa.String(128), nullable=False),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(64)),
        sa.Column("provider", sa.String(64)),
        sa.Column("provider_model", sa.String(255)),
        sa.Column("fallback_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("security_decision", sa.String(32)),
        sa.Column("risk_score", sa.Float()),
        sa.Column("policy_version", sa.Integer()),
        sa.Column("cache_status", sa.String(32)),
        sa.Column("prompt_hash", sa.String(64)),
        sa.Column("input_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_chars", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("events", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("content_preview", postgresql.JSONB()),
        sa.Column("content_expires_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_request_traces_client_started", "request_traces", ["client_id", "started_at"]
    )
    op.create_index("ix_request_traces_status_started", "request_traces", ["status", "started_at"])
    op.create_index("ix_request_traces_correlation_id", "request_traces", ["correlation_id"])
    op.create_index("ix_request_traces_started_at", "request_traces", ["started_at"])

    # 2. usage_records
    op.create_table(
        "usage_records",
        sa.Column("request_id", sa.String(128), primary_key=True),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id")),
        sa.Column("provider", sa.String(64)),
        sa.Column("provider_model", sa.String(255)),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("tokens_source", sa.String(32), nullable=False),
        sa.Column("estimated_cost", sa.Numeric(12, 6)),
        sa.Column("cost_status", sa.String(32), nullable=False),
        sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("saved_tokens", sa.Integer()),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_usage_records_client_created", "usage_records", ["client_id", "created_at"])
    op.create_index(
        "ix_usage_records_provider_model_created",
        "usage_records",
        ["provider", "provider_model", "created_at"],
    )
    op.create_index("ix_usage_records_created_at", "usage_records", ["created_at"])


def downgrade() -> None:
    op.drop_table("usage_records")
    op.drop_table("request_traces")
