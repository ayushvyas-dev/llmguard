"""Admin API endpoints for usage records and metrics overview."""

import math
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, select

from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.db.models import RequestTrace, SecurityEvent, UsageRecord

router = APIRouter(tags=["admin-usage"])


@router.get("/usage")
async def get_usage(
    request: Request,
    group_by: str | None = Query(None, description="Comma-separated: client, provider, model"),
    client_id: UUID | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Aggregated usage and cost summaries by client, provider, or model."""
    session_factory = request.app.state.session_factory

    groups = [g.strip().lower() for g in group_by.split(",")] if group_by else []

    select_cols = []
    group_by_cols = []

    if "client" in groups:
        select_cols.append(UsageRecord.client_id.label("client_id"))
        group_by_cols.append(UsageRecord.client_id)
    if "provider" in groups:
        select_cols.append(UsageRecord.provider.label("provider"))
        group_by_cols.append(UsageRecord.provider)
    if "model" in groups:
        select_cols.append(UsageRecord.provider_model.label("model"))
        group_by_cols.append(UsageRecord.provider_model)

    select_cols.extend(
        [
            func.count(UsageRecord.request_id).label("total_requests"),
            func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("output_tokens"),
            func.coalesce(
                func.sum(
                    func.coalesce(UsageRecord.input_tokens, 0)
                    + func.coalesce(UsageRecord.output_tokens, 0)
                ),
                0,
            ).label("total_tokens"),
            func.coalesce(func.sum(UsageRecord.estimated_cost), 0.0).label("estimated_cost"),
            func.coalesce(func.sum(UsageRecord.saved_tokens), 0).label("saved_tokens"),
        ]
    )

    stmt = select(*select_cols)
    if client_id:
        stmt = stmt.where(UsageRecord.client_id == client_id)
    if start_time:
        stmt = stmt.where(UsageRecord.created_at >= start_time)
    if end_time:
        stmt = stmt.where(UsageRecord.created_at <= end_time)

    if group_by_cols:
        stmt = stmt.group_by(*group_by_cols)

    async with session_factory() as session:
        res = await session.execute(stmt)
        rows = res.all()

        results = []
        for row in rows:
            data = {
                "total_requests": row.total_requests,
                "input_tokens": int(row.input_tokens),
                "output_tokens": int(row.output_tokens),
                "total_tokens": int(row.total_tokens),
                "estimated_cost": float(row.estimated_cost),
                "saved_tokens": int(row.saved_tokens),
            }
            if "client" in groups:
                data["client_id"] = str(row.client_id) if row.client_id else None
            if "provider" in groups:
                data["provider"] = row.provider
            if "model" in groups:
                data["model"] = row.model
            results.append(data)

        return {"usage": results}


@router.get("/metrics/overview")
async def get_metrics_overview(
    request: Request,
    client_id: UUID | None = Query(None),
    start_time: datetime | None = Query(None),
    end_time: datetime | None = Query(None),
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """System-wide or per-client metrics overview.

    Calculates volume, success rate, percentiles, cost, and tokens.
    """
    session_factory = request.app.state.session_factory

    async with session_factory() as session:
        # 1. Query usage records
        usage_stmt = select(
            func.count(UsageRecord.request_id).label("total_requests"),
            func.coalesce(func.sum(UsageRecord.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(UsageRecord.output_tokens), 0).label("output_tokens"),
            func.coalesce(func.sum(UsageRecord.estimated_cost), 0.0).label("estimated_cost"),
            func.coalesce(func.sum(case((UsageRecord.cache_hit.is_(True), 1), else_=0)), 0).label(
                "cache_hits"
            ),
            func.coalesce(func.sum(UsageRecord.saved_tokens), 0).label("saved_tokens"),
        )
        if client_id:
            usage_stmt = usage_stmt.where(UsageRecord.client_id == client_id)
        if start_time:
            usage_stmt = usage_stmt.where(UsageRecord.created_at >= start_time)
        if end_time:
            usage_stmt = usage_stmt.where(UsageRecord.created_at <= end_time)

        u_res = await session.execute(usage_stmt)
        u_row = u_res.one()
        total_requests = u_row.total_requests or 0
        input_tokens = int(u_row.input_tokens)
        output_tokens = int(u_row.output_tokens)
        estimated_cost = float(u_row.estimated_cost)
        cache_hits = int(u_row.cache_hits)
        saved_tokens = int(u_row.saved_tokens)

        # 2. Query latencies and statuses from RequestTrace
        trace_stmt = select(RequestTrace.status, RequestTrace.latency_ms)
        if client_id:
            trace_stmt = trace_stmt.where(RequestTrace.client_id == client_id)
        if start_time:
            trace_stmt = trace_stmt.where(RequestTrace.started_at >= start_time)
        if end_time:
            trace_stmt = trace_stmt.where(RequestTrace.started_at <= end_time)

        t_res = await session.execute(trace_stmt)
        trace_rows = t_res.all()

        successful = sum(1 for r in trace_rows if r.status in ("success", "cache_hit"))
        blocked = sum(1 for r in trace_rows if r.status == "blocked")
        latencies = sorted([r.latency_ms for r in trace_rows if r.latency_ms is not None])

        def percentile(values: list[int], p: float) -> float:
            if not values:
                return 0.0
            k = (len(values) - 1) * p
            f = math.floor(k)
            c = math.ceil(k)
            if f == c:
                return float(values[int(k)])
            d0 = values[int(f)] * (c - k)
            d1 = values[int(c)] * (k - f)
            return float(d0 + d1)

        # 3. Security events count
        sec_stmt = select(func.count(SecurityEvent.id))
        if client_id:
            sec_stmt = sec_stmt.where(SecurityEvent.client_id == client_id)
        if start_time:
            sec_stmt = sec_stmt.where(SecurityEvent.created_at >= start_time)
        if end_time:
            sec_stmt = sec_stmt.where(SecurityEvent.created_at <= end_time)

        sec_res = await session.execute(sec_stmt)
        security_events_count = sec_res.scalar() or 0

        success_rate = (successful / len(trace_rows)) if trace_rows else 1.0
        cache_hit_rate = (cache_hits / total_requests) if total_requests else 0.0

        return {
            "total_requests": total_requests,
            "success_rate": round(success_rate, 4),
            "p50_latency_ms": round(percentile(latencies, 0.50), 2),
            "p95_latency_ms": round(percentile(latencies, 0.95), 2),
            "p99_latency_ms": round(percentile(latencies, 0.99), 2),
            "total_input_tokens": input_tokens,
            "total_output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "total_saved_tokens": saved_tokens,
            "estimated_cost_usd": round(estimated_cost, 6),
            "cache_hit_rate": round(cache_hit_rate, 4),
            "security_events_count": security_events_count,
            "blocked_requests_count": blocked,
        }
