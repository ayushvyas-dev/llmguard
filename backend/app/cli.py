"""LLMGuard CLI for admin management, client provisioning, and key lifecycle."""

import argparse
import asyncio
import sys
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit.service import record_audit_event
from app.auth.keys import generate_key, hash_key
from app.core.clock import utc_now
from app.core.config import Settings, get_settings
from app.db.models import ApiKey, Client, ClientStatus, KeyRole, KeyStatus
from app.db.session import make_engine, make_session_factory


async def handle_create_admin(
    args: argparse.Namespace,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    settings: Settings | None = None,
) -> int:
    settings = settings or get_settings()
    engine = None
    if session_factory is None:
        engine = make_engine(settings)
        session_factory = make_session_factory(engine)
    name = args.name

    try:
        async with session_factory() as session:
            existing = await session.execute(select(Client).where(Client.name == name))
            admin_client = existing.scalar_one_or_none()
            if admin_client is None:
                admin_client = Client(
                    id=uuid4(),
                    name=name,
                    status=ClientStatus.ACTIVE,
                )
                session.add(admin_client)
                await session.commit()
                await session.refresh(admin_client)

            # Generate admin key
            pepper = settings.api_key_pepper or ""
            full_key, prefix, secret = generate_key(settings.app_env, role="admin")
            key_hash = hash_key(secret, pepper)

            key = ApiKey(
                id=uuid4(),
                client_id=admin_client.id,
                prefix=prefix,
                key_hash=key_hash,
                role=KeyRole.ADMIN,
                status=KeyStatus.ACTIVE,
                label=f"Admin key for {name}",
            )
            session.add(key)
            await session.commit()

            # Audit event
            await record_audit_event(
                session,
                actor="cli",
                action="admin.create",
                target_type="client",
                target_id=str(admin_client.id),
                summary={"name": name, "key_prefix": prefix},
            )

        print(f"Created admin client '{name}' (ID: {admin_client.id})")
        print(f"Admin API Key (copy now; will not be shown again):\n  {full_key}")
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


async def handle_create_client(
    args: argparse.Namespace,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    settings: Settings | None = None,
) -> int:
    settings = settings or get_settings()
    engine = None
    if session_factory is None:
        engine = make_engine(settings)
        session_factory = make_session_factory(engine)
    name = args.name

    policy_id = None
    if args.policy_id:
        try:
            policy_id = UUID(args.policy_id)
        except ValueError:
            print(f"Error: Invalid policy ID UUID: {args.policy_id}", file=sys.stderr)
            if engine is not None:
                await engine.dispose()
            return 1

    try:
        async with session_factory() as session:
            client = Client(
                id=uuid4(),
                name=name,
                status=ClientStatus.ACTIVE,
                security_policy_id=policy_id,
                rate_limit_rpm=args.rate_limit,
            )
            session.add(client)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                print(f"Error: Client with name '{name}' already exists.", file=sys.stderr)
                return 1

            await session.refresh(client)

            await record_audit_event(
                session,
                actor="cli",
                action="client.create",
                target_type="client",
                target_id=str(client.id),
                summary={"name": name, "rate_limit_rpm": client.rate_limit_rpm},
            )

        print(f"Created client '{name}' (ID: {client.id})")
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


async def handle_create_key(
    args: argparse.Namespace,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    settings: Settings | None = None,
) -> int:
    settings = settings or get_settings()
    engine = None
    if session_factory is None:
        engine = make_engine(settings)
        session_factory = make_session_factory(engine)
    client_identifier = args.client

    try:
        async with session_factory() as session:
            client = None
            try:
                client_uuid = UUID(client_identifier)
                res = await session.execute(select(Client).where(Client.id == client_uuid))
                client = res.scalar_one_or_none()
            except ValueError:
                pass

            if client is None:
                res = await session.execute(select(Client).where(Client.name == client_identifier))
                client = res.scalar_one_or_none()

            if client is None:
                print(f"Error: Client '{client_identifier}' not found.", file=sys.stderr)
                return 1

            role = KeyRole.ADMIN if args.role == "admin" else KeyRole.CLIENT
            pepper = settings.api_key_pepper or ""
            full_key, prefix, secret = generate_key(settings.app_env, role=role.value)
            key_hash = hash_key(secret, pepper)

            expires_at = None
            if args.expires_days:
                expires_at = utc_now() + timedelta(days=args.expires_days)

            key = ApiKey(
                id=uuid4(),
                client_id=client.id,
                prefix=prefix,
                key_hash=key_hash,
                role=role,
                status=KeyStatus.ACTIVE,
                expires_at=expires_at,
                label=args.label,
            )
            session.add(key)
            await session.commit()

            await record_audit_event(
                session,
                actor="cli",
                action="key.create",
                target_type="key",
                target_id=prefix,
                summary={"client_id": str(client.id), "prefix": prefix, "role": role.value},
            )

        print(f"Created {role.value} key for client '{client.name}' (prefix: {prefix})")
        print(f"API Key (copy now; will not be shown again):\n  {full_key}")
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


async def handle_revoke_key(
    args: argparse.Namespace,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    settings: Settings | None = None,
) -> int:
    settings = settings or get_settings()
    engine = None
    if session_factory is None:
        engine = make_engine(settings)
        session_factory = make_session_factory(engine)
    prefix = args.prefix

    try:
        async with session_factory() as session:
            res = await session.execute(select(ApiKey).where(ApiKey.prefix == prefix))
            key = res.scalar_one_or_none()
            if key is None:
                print(f"Error: Key with prefix '{prefix}' not found.", file=sys.stderr)
                return 1

            key.status = KeyStatus.REVOKED
            key.revoked_at = utc_now()
            await session.commit()

            await record_audit_event(
                session,
                actor="cli",
                action="key.revoke",
                target_type="key",
                target_id=prefix,
                summary={"prefix": prefix, "client_id": str(key.client_id)},
            )

        print(f"Successfully revoked key with prefix '{prefix}'")
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


async def handle_cleanup_retention(
    _args: argparse.Namespace,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    settings: Settings | None = None,
) -> int:
    from app.observability.cleanup import cleanup_retention

    settings = settings or get_settings()
    engine = None
    if session_factory is None:
        engine = make_engine(settings)
        session_factory = make_session_factory(engine)

    try:
        results = await cleanup_retention(session_factory, settings)
        print("Retention cleanup completed:")
        for k, v in results.items():
            print(f"  {k}: {v}")
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="LLMGuard Command Line Interface",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # create-admin
    admin_parser = subparsers.add_parser("create-admin", help="Create an admin client and API key")
    admin_parser.add_argument("--name", default="admin", help="Admin client name (default: admin)")

    # create-client
    client_parser = subparsers.add_parser("create-client", help="Create a client")
    client_parser.add_argument("--name", required=True, help="Client name")
    client_parser.add_argument("--policy-id", help="Optional security policy ID UUID")
    client_parser.add_argument("--rate-limit", type=int, help="Optional rate limit RPM")

    # create-key
    key_parser = subparsers.add_parser("create-key", help="Create an API key for a client")
    key_parser.add_argument("--client", required=True, help="Client name or UUID")
    key_parser.add_argument(
        "--role", choices=["client", "admin"], default="client", help="Key role (default: client)"
    )
    key_parser.add_argument("--expires-days", type=int, help="Optional expiry in days")
    key_parser.add_argument("--label", help="Optional label for the key")

    # revoke-key
    revoke_parser = subparsers.add_parser("revoke-key", help="Revoke an API key by prefix")
    revoke_parser.add_argument("--prefix", required=True, help="Key prefix to revoke")

    # cleanup-retention
    subparsers.add_parser(
        "cleanup-retention", help="Purge expired traces, usage records, and content previews"
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    handlers = {
        "create-admin": handle_create_admin,
        "create-client": handle_create_client,
        "create-key": handle_create_key,
        "revoke-key": handle_revoke_key,
        "cleanup-retention": handle_cleanup_retention,
    }

    handler = handlers[args.command]
    sys.exit(asyncio.run(handler(args)))


if __name__ == "__main__":
    main()
