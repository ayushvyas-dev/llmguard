"""B3 security events.

Revision ID: 0002_b3
Revises: 0001_b1
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_b3"
down_revision = "0001_b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("request_id", sa.String(128)),
        sa.Column("client_id", sa.Uuid(), sa.ForeignKey("clients.id")),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("detector", sa.String(128), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("reason_codes", postgresql.ARRAY(sa.String()), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_security_events_created_at", "security_events", ["created_at"])
    op.create_index(
        "ix_security_events_client_created", "security_events", ["client_id", "created_at"]
    )
    op.create_index(
        "ix_security_events_category_action_created",
        "security_events",
        ["category", "action", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_security_events_category_action_created", table_name="security_events")
    op.drop_index("ix_security_events_client_created", table_name="security_events")
    op.drop_index("ix_security_events_created_at", table_name="security_events")
    op.drop_table("security_events")
