"""Pricing lookup, cost calculation, and token estimation."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Pricing


def estimate_tokens(text: str | None) -> int:
    """Heuristic token count estimation (approx 4 chars per token)."""
    if not text:
        return 0
    return max(1, len(text) // 4)


@dataclass(frozen=True)
class PricingResult:
    estimated_cost: Decimal | None
    cost_status: str  # "estimated", "unpriced", "zero_cached"
    cost_is_estimate: bool = True


class PricingService:
    @staticmethod
    async def seed_pricing_if_empty(session: AsyncSession) -> int:
        """Seed pricing table from config/pricing_seed.json if empty."""
        existing = await session.execute(select(Pricing).limit(1))
        if existing.scalar_one_or_none() is not None:
            return 0

        seed_file = Path(__file__).parents[2] / "config" / "pricing_seed.json"
        if not seed_file.exists():
            return 0

        rows = json.loads(seed_file.read_text())
        now = datetime.now(UTC)
        seeded = 0
        for row in rows:
            in_p = (
                Decimal(str(row["input_price_per_mtok"]))
                if row.get("input_price_per_mtok") is not None
                else None
            )
            out_p = (
                Decimal(str(row["output_price_per_mtok"]))
                if row.get("output_price_per_mtok") is not None
                else None
            )
            p = Pricing(
                id=uuid4(),
                provider=row["provider"],
                provider_model_id=row["provider_model_id"],
                input_price_per_mtok=in_p,
                output_price_per_mtok=out_p,
                currency=row.get("currency", "USD"),
                effective_from=now,
                source_note=row.get("source_note"),
            )
            session.add(p)
            seeded += 1
        await session.commit()
        return seeded

    @staticmethod
    async def calculate_cost(
        session: AsyncSession,
        provider: str | None,
        provider_model: str | None,
        input_tokens: int | None,
        output_tokens: int | None,
        at_time: datetime | None = None,
        is_cache_hit: bool = False,
    ) -> PricingResult:
        """Calculate estimated cost for a request."""
        if is_cache_hit:
            return PricingResult(
                estimated_cost=Decimal("0.0"),
                cost_status="zero_cached",
                cost_is_estimate=True,
            )

        if not provider or not provider_model:
            return PricingResult(
                estimated_cost=None,
                cost_status="unpriced",
                cost_is_estimate=True,
            )

        try:
            timestamp = at_time or datetime.now(UTC)
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)

            stmt = (
                select(Pricing)
                .where(
                    Pricing.provider == provider,
                    Pricing.provider_model_id == provider_model,
                    Pricing.effective_from <= timestamp,
                )
                .order_by(Pricing.effective_from.desc())
                .limit(1)
            )
            res = await session.execute(stmt)
            pricing_row = res.scalar_one_or_none()

            if pricing_row is None:
                return PricingResult(
                    estimated_cost=None,
                    cost_status="unpriced",
                    cost_is_estimate=True,
                )

            in_p = pricing_row.input_price_per_mtok
            out_p = pricing_row.output_price_per_mtok
            if in_p is None and out_p is None:
                return PricingResult(
                    estimated_cost=None,
                    cost_status="unpriced",
                    cost_is_estimate=True,
                )

            in_tokens = Decimal(input_tokens or 0)
            out_tokens = Decimal(output_tokens or 0)
            in_cost = (in_tokens * (in_p or Decimal("0.0"))) / Decimal("1000000")
            out_cost = (out_tokens * (out_p or Decimal("0.0"))) / Decimal("1000000")
            total_cost = round(in_cost + out_cost, 6)

            return PricingResult(
                estimated_cost=total_cost,
                cost_status="estimated",
                cost_is_estimate=True,
            )
        except Exception:
            return PricingResult(
                estimated_cost=None,
                cost_status="unpriced",
                cost_is_estimate=True,
            )
