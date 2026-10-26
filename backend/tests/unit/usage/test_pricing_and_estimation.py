"""Unit tests for pricing lookup, cost estimation, and token counting."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models import Pricing
from app.usage.pricing import PricingService, estimate_tokens


def test_estimate_tokens_heuristic() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens(None) == 0
    assert estimate_tokens("hi") == 1  # max(1, 2 // 4)
    sample = "hello world this is a test string"
    assert estimate_tokens(sample) == len(sample) // 4


@pytest.fixture
async def pricing_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


async def test_pricing_effective_from_resolution(pricing_db) -> None:
    now = datetime.now(UTC)
    t_past = now - timedelta(days=30)
    t_recent = now - timedelta(days=10)
    t_future = now + timedelta(days=10)

    async with pricing_db() as session:
        # Older price: $1.00 / $2.00
        session.add(
            Pricing(
                id=uuid4(),
                provider="test-prov",
                provider_model_id="test-model",
                input_price_per_mtok=Decimal("1.00"),
                output_price_per_mtok=Decimal("2.00"),
                effective_from=t_past,
            )
        )
        # Recent price: $0.50 / $1.50
        session.add(
            Pricing(
                id=uuid4(),
                provider="test-prov",
                provider_model_id="test-model",
                input_price_per_mtok=Decimal("0.50"),
                output_price_per_mtok=Decimal("1.50"),
                effective_from=t_recent,
            )
        )
        # Future price: $0.10 / $0.20
        session.add(
            Pricing(
                id=uuid4(),
                provider="test-prov",
                provider_model_id="test-model",
                input_price_per_mtok=Decimal("0.10"),
                output_price_per_mtok=Decimal("0.20"),
                effective_from=t_future,
            )
        )
        await session.commit()

    async with pricing_db() as session:
        # Request at 'now' should resolve the 'recent' price ($0.50 in, $1.50 out), NOT future
        res = await PricingService.calculate_cost(
            session,
            provider="test-prov",
            provider_model="test-model",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            at_time=now,
        )
        assert res.cost_status == "estimated"
        assert res.cost_is_estimate is True
        # 1M * 0.50 + 1M * 1.50 = 2.00 USD
        assert res.estimated_cost == Decimal("2.000000")

        # Request at t_past + 5 days should resolve the older price ($1.00 in, $2.00 out)
        res_old = await PricingService.calculate_cost(
            session,
            provider="test-prov",
            provider_model="test-model",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            at_time=t_past + timedelta(days=5),
        )
        assert res_old.estimated_cost == Decimal("3.000000")


async def test_unpriced_model_returns_unpriced_status(pricing_db) -> None:
    async with pricing_db() as session:
        res = await PricingService.calculate_cost(
            session,
            provider="unknown-prov",
            provider_model="unknown-model",
            input_tokens=500,
            output_tokens=200,
        )
        assert res.estimated_cost is None
        assert res.cost_status == "unpriced"
        assert res.cost_is_estimate is True


async def test_cache_hit_returns_zero_cached_cost(pricing_db) -> None:
    async with pricing_db() as session:
        res = await PricingService.calculate_cost(
            session,
            provider="any-prov",
            provider_model="any-model",
            input_tokens=500,
            output_tokens=200,
            is_cache_hit=True,
        )
        assert res.estimated_cost == Decimal("0.0")
        assert res.cost_status == "zero_cached"
        assert res.cost_is_estimate is True
