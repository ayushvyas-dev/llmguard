"""B1 baseline tables.

Revision ID: 0001_b1
Revises:
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_b1"
down_revision = None
branch_labels = None
depends_on = None

client_status_type = postgresql.ENUM("active", "disabled", name="clientstatus")
key_role_type = postgresql.ENUM("client", "admin", name="keyrole")
key_status_type = postgresql.ENUM("active", "revoked", name="keystatus")
provider_type = postgresql.ENUM("groq", "gemini", name="provider")

client_status = postgresql.ENUM("active", "disabled", name="clientstatus", create_type=False)
key_role = postgresql.ENUM("client", "admin", name="keyrole", create_type=False)
key_status = postgresql.ENUM("active", "revoked", name="keystatus", create_type=False)
provider = postgresql.ENUM("groq", "gemini", name="provider", create_type=False)


def policy_table(name: str) -> None:
    op.create_table(
        name,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", "version", name=f"uq_{name}_name_version"),
    )


def upgrade() -> None:
    bind = op.get_bind()
    for enum in (client_status_type, key_role_type, key_status_type, provider_type):
        enum.create(bind, checkfirst=True)
    policy_table("security_policies")
    policy_table("routing_policies")
    op.create_table(
        "clients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("status", client_status, nullable=False),
        sa.Column("security_policy_id", sa.Uuid(), sa.ForeignKey("security_policies.id")),
        sa.Column("routing_policy_id", sa.Uuid(), sa.ForeignKey("routing_policies.id")),
        sa.Column("rate_limit_rpm", sa.Integer()),
        sa.Column("window_seconds", sa.Integer()),
        sa.Column("daily_token_quota", sa.BigInteger()),
        sa.Column("monthly_cost_quota", sa.Numeric()),
        sa.Column("allowed_models", postgresql.ARRAY(sa.String())),
        sa.Column("store_content", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_clients_status", "clients", ["status"])
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id"), nullable=False),
        sa.Column("prefix", sa.String(255), nullable=False, unique=True),
        sa.Column("key_hash", sa.LargeBinary(), nullable=False),
        sa.Column("role", key_role, nullable=False),
        sa.Column("status", key_status, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("label", sa.String(255)),
    )
    op.create_index("ix_api_keys_client_status", "api_keys", ["client_id", "status"])
    op.create_table(
        "provider_models",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("alias", sa.String(255), nullable=False, unique=True),
        sa.Column("provider", provider, nullable=False),
        sa.Column("provider_model_id", sa.String(255), nullable=False),
        sa.Column("capabilities", postgresql.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "pricing",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("provider_model_id", sa.String(255), nullable=False),
        sa.Column("input_price_per_mtok", sa.Numeric()),
        sa.Column("output_price_per_mtok", sa.Numeric()),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_note", sa.Text()),
    )


def downgrade() -> None:
    op.drop_table("pricing")
    op.drop_table("provider_models")
    op.drop_index("ix_api_keys_client_status", table_name="api_keys")
    op.drop_table("api_keys")
    op.drop_index("ix_clients_status", table_name="clients")
    op.drop_table("clients")
    op.drop_table("routing_policies")
    op.drop_table("security_policies")
    bind = op.get_bind()
    for enum in (provider, key_status, key_role, client_status):
        enum.drop(bind, checkfirst=True)
