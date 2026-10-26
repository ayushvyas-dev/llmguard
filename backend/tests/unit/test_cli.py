"""Unit tests for LLMGuard CLI commands."""

import argparse

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.cli import (
    build_parser,
    handle_create_admin,
    handle_create_client,
    handle_create_key,
    handle_revoke_key,
)
from app.core.config import Settings
from app.db.base import Base
from app.db.models import ApiKey, AuditEvent, Client, KeyRole, KeyStatus


@pytest.fixture
async def cli_env():
    """Set up in-memory DB and session factory."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    test_settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        api_key_pepper="cli_test_pepper_at_least_32_chars!",
    )

    yield session_factory, test_settings
    await engine.dispose()


class TestCliParser:
    def test_parser_subcommands(self):
        parser = build_parser()
        # Test create-admin
        args = parser.parse_args(["create-admin", "--name", "superadmin"])
        assert args.command == "create-admin"
        assert args.name == "superadmin"

        # Test create-client
        args = parser.parse_args(["create-client", "--name", "tenant-1", "--rate-limit", "100"])
        assert args.command == "create-client"
        assert args.name == "tenant-1"
        assert args.rate_limit == 100

        # Test create-key
        args = parser.parse_args(["create-key", "--client", "tenant-1", "--role", "admin"])
        assert args.command == "create-key"
        assert args.client == "tenant-1"
        assert args.role == "admin"

        # Test revoke-key
        args = parser.parse_args(["revoke-key", "--prefix", "abc12345"])
        assert args.command == "revoke-key"
        assert args.prefix == "abc12345"


class TestCliExecution:
    async def test_create_admin(self, cli_env, capsys):
        session_factory, settings = cli_env
        args = argparse.Namespace(name="admin-corp")
        ret = await handle_create_admin(args, session_factory=session_factory, settings=settings)
        assert ret == 0

        out = capsys.readouterr().out
        assert "Created admin client 'admin-corp'" in out
        assert "lga_dev_" in out

        # Verify DB records
        async with session_factory() as session:
            res = await session.execute(select(Client).where(Client.name == "admin-corp"))
            client = res.scalar_one_or_none()
            assert client is not None

            key_res = await session.execute(select(ApiKey).where(ApiKey.client_id == client.id))
            key = key_res.scalar_one_or_none()
            assert key is not None
            assert key.role == KeyRole.ADMIN

            audit_res = await session.execute(
                select(AuditEvent).where(AuditEvent.action == "admin.create")
            )
            audit = audit_res.scalar_one_or_none()
            assert audit is not None
            assert audit.actor == "cli"

    async def test_create_client(self, cli_env, capsys):
        session_factory, settings = cli_env
        args = argparse.Namespace(name="acme", policy_id=None, rate_limit=50)
        ret = await handle_create_client(args, session_factory=session_factory, settings=settings)
        assert ret == 0

        out = capsys.readouterr().out
        assert "Created client 'acme'" in out

        # Duplicate client should return 1
        ret_dup = await handle_create_client(
            args, session_factory=session_factory, settings=settings
        )
        assert ret_dup == 1

        async with session_factory() as session:
            audit_res = await session.execute(
                select(AuditEvent).where(AuditEvent.action == "client.create")
            )
            audits = audit_res.scalars().all()
            assert len(audits) == 1

    async def test_create_key_and_revoke_key(self, cli_env, capsys):
        session_factory, settings = cli_env
        # Create client first
        await handle_create_client(
            argparse.Namespace(name="key-tenant", policy_id=None, rate_limit=None),
            session_factory=session_factory,
            settings=settings,
        )

        # Create key
        args = argparse.Namespace(
            client="key-tenant", role="client", expires_days=30, label="Production key"
        )
        ret = await handle_create_key(args, session_factory=session_factory, settings=settings)
        assert ret == 0

        out = capsys.readouterr().out
        assert "lg_dev_" in out
        # Extract prefix from DB
        async with session_factory() as session:
            res = await session.execute(select(ApiKey))
            db_key = res.scalar_one_or_none()
            assert db_key is not None
            prefix = db_key.prefix
            assert db_key.status == KeyStatus.ACTIVE

        # Revoke key
        ret_revoke = await handle_revoke_key(
            argparse.Namespace(prefix=prefix),
            session_factory=session_factory,
            settings=settings,
        )
        assert ret_revoke == 0

        async with session_factory() as session:
            res = await session.execute(select(ApiKey).where(ApiKey.prefix == prefix))
            db_key = res.scalar_one_or_none()
            assert db_key.status == KeyStatus.REVOKED
            assert db_key.revoked_at is not None
