from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select

from app.auth.dependencies import require_gateway_auth
from app.auth.service import AuthResult
from app.core.errors import GatewayError
from app.db.models import SecurityPolicy
from app.observability.recorder import TraceRecorder
from app.schemas.chat import ChatCompletionRequest, ChatCompletionResponse

router = APIRouter(tags=["chat"])


@router.post("/chat/completions", response_model=ChatCompletionResponse)
async def chat_completions(
    body: ChatCompletionRequest,
    request: Request,
    response: Response,
    auth: AuthResult = Depends(require_gateway_auth),
) -> ChatCompletionResponse:
    settings = request.app.state.settings
    recorder = TraceRecorder(
        request_id=request.state.request_id,
        correlation_id=request.state.correlation_id,
        client_id=auth.client.id,
        store_content=auth.client.store_content,
        max_events=settings.trace_max_events,
        max_bytes=settings.trace_max_bytes,
        content_retention_days=settings.content_storage_retention_days,
    )
    recorder.record_event("request_received")
    recorder.record_event(
        "auth",
        outcome="ok",
        attributes={"client_id": str(auth.client.id), "key_prefix": auth.key.prefix},
    )

    # 1. Enforce rate limiting
    rate_limiter = getattr(request.app.state, "rate_limiter", None)
    rate_result = None
    if rate_limiter is not None:
        client_id = str(auth.client.id)
        limit = auth.client.rate_limit_rpm
        window = auth.client.window_seconds
        rate_result = await rate_limiter.check(client_id, limit=limit, window_seconds=window)
        if not rate_result.allowed:
            recorder.record_event(
                "rate_limit", outcome="blocked", attributes={"limit": rate_result.limit}
            )
            recorder.record_event(
                "response_sent", outcome="blocked", attributes={"http_status": 429}
            )
            trace = recorder.build_trace(
                status="blocked", http_status=429, error_code="rate_limited"
            )
            usage = recorder.build_usage(status="blocked", tokens_source="missing")
            if getattr(request.app.state, "trace_writer", None):
                await request.app.state.trace_writer.write(trace, usage)

            headers = {
                "Retry-After": str(rate_result.retry_after),
                "X-RateLimit-Limit": str(rate_result.limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(rate_result.reset_seconds),
            }
            raise GatewayError(
                status_code=429,
                code="rate_limited",
                message=f"Rate limit exceeded. Try again in {rate_result.retry_after} seconds.",
                error_type="rate_limit_error",
                details={"retry_after": rate_result.retry_after},
                headers=headers,
            )

    recorder.record_event(
        "rate_limit",
        outcome="ok",
        attributes={"limit": rate_result.limit if rate_result else None},
    )

    # 2. Enforce per-client model whitelist
    if auth.client.allowed_models and body.model not in auth.client.allowed_models:
        recorder.record_event("validation", outcome="error", attributes={"model": body.model})
        recorder.record_event("response_sent", outcome="error", attributes={"http_status": 403})
        trace = recorder.build_trace(
            status="error", http_status=403, error_code="model_not_allowed"
        )
        usage = recorder.build_usage(status="error", tokens_source="missing")
        if getattr(request.app.state, "trace_writer", None):
            await request.app.state.trace_writer.write(trace, usage)

        raise GatewayError(
            status_code=403,
            code="model_not_allowed",
            message=f"Model '{body.model}' is not permitted for client '{auth.client.name}'.",
            error_type="permission_error",
        )

    recorder.record_event("validation", outcome="ok", attributes={"model": body.model})

    # 3. Resolve per-client security and routing policy overrides
    client_policy = None
    client_routing_policy = None
    if auth.client.security_policy_id or auth.client.routing_policy_id:
        from app.db.models import RoutingPolicy as DbRoutingPolicy

        async with request.app.state.session_factory() as session:
            if auth.client.security_policy_id:
                stmt = select(SecurityPolicy).where(
                    SecurityPolicy.id == auth.client.security_policy_id
                )
                res = await session.execute(stmt)
                policy_row = res.scalar_one_or_none()
                if policy_row is not None:
                    client_policy = policy_row.config
            if auth.client.routing_policy_id:
                stmt = select(DbRoutingPolicy).where(
                    DbRoutingPolicy.id == auth.client.routing_policy_id
                )
                res = await session.execute(stmt)
                routing_row = res.scalar_one_or_none()
                if routing_row is not None:
                    client_routing_policy = routing_row.config

    # 4. Attach rate limit headers to successful response
    if rate_result is not None:
        response.headers["X-RateLimit-Limit"] = str(rate_result.limit)
        response.headers["X-RateLimit-Remaining"] = str(rate_result.remaining)
        response.headers["X-RateLimit-Reset"] = str(rate_result.reset_seconds)

    # 5. Complete request via orchestrator
    return await request.app.state.orchestrator.complete(
        body,
        request.state.request_id,
        request.state.correlation_id,
        policy=client_policy,
        routing_policy=client_routing_policy,
        client_allowed_models=auth.client.allowed_models,
        is_cancelled=request.is_disconnected,
        recorder=recorder,
        client_id=auth.client.id,
        store_content=auth.client.store_content,
        trace_writer=getattr(request.app.state, "trace_writer", None),
        session_factory=getattr(request.app.state, "session_factory", None),
        cache_service=getattr(request.app.state, "cache_service", None),
    )
