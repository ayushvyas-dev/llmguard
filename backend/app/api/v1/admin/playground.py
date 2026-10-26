"""Admin API playground endpoint using designated playground client."""

from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult
from app.core.errors import GatewayError
from app.db.models import Client, ClientStatus
from app.observability.recorder import TraceRecorder
from app.schemas.chat import ChatCompletionRequest

router = APIRouter(tags=["admin-playground"])


@router.get("/playground/models")
async def get_playground_models(
    request: Request,
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Return available models in the catalog for the playground dropdown."""
    catalog = request.app.state.orchestrator.catalog
    models = [
        {
            "alias": m.alias,
            "provider": m.provider,
            "provider_model_id": m.provider_model_id,
            "capabilities": m.capabilities,
            "enabled": m.enabled,
        }
        for m in catalog.models.values()
        if m.enabled
    ]
    return {"models": models}


@router.post("/playground/completions")
async def run_playground_completion(
    body: ChatCompletionRequest,
    request: Request,
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Run a prompt through the gateway using the designated playground client.

    Returns the standard completion response along with a structured trace summary
    for immediate playground inspection and a link to the persisted trace.
    """
    settings = request.app.state.settings

    # Resolve or create the designated playground client
    async with request.app.state.session_factory() as session:
        stmt = select(Client).where(Client.name == "playground")
        res = await session.execute(stmt)
        playground_client = res.scalar_one_or_none()
        if playground_client is None:
            playground_client = Client(
                id=uuid4(),
                name="playground",
                status=ClientStatus.ACTIVE,
                store_content=True,
            )
            session.add(playground_client)
            await session.commit()
            await session.refresh(playground_client)

    client_id = playground_client.id
    request_id = request.state.request_id
    correlation_id = request.state.correlation_id

    recorder = TraceRecorder(
        request_id=request_id,
        correlation_id=correlation_id,
        client_id=client_id,
        store_content=True,
        max_events=settings.trace_max_events,
        max_bytes=settings.trace_max_bytes,
        content_retention_days=settings.content_storage_retention_days,
    )
    recorder.record_event("request_received")
    recorder.record_event(
        "auth",
        outcome="ok",
        attributes={"client_id": str(client_id), "playground": True},
    )

    try:
        final_response = await request.app.state.orchestrator.complete(
            body,
            request_id=request_id,
            correlation_id=correlation_id,
            recorder=recorder,
            client_id=client_id,
            store_content=True,
            trace_writer=getattr(request.app.state, "trace_writer", None),
            session_factory=getattr(request.app.state, "session_factory", None),
            cache_service=getattr(request.app.state, "cache_service", None),
        )

        trace_summary = {
            "request_id": final_response.gateway.request_id,
            "correlation_id": final_response.gateway.correlation_id,
            "provider": final_response.provider,
            "provider_model": final_response.provider_model,
            "latency_ms": final_response.gateway.latency_ms,
            "prompt_tokens": final_response.usage.prompt_tokens,
            "completion_tokens": final_response.usage.completion_tokens,
            "total_tokens": final_response.usage.total_tokens,
            "estimated_cost_usd": final_response.usage.estimated_cost_usd,
            "cost_is_estimate": True,
            "cache_status": final_response.gateway.cache.get("status", "bypass"),
            "security_decision": final_response.gateway.security.get("decision", "allow"),
            "risk_score": final_response.gateway.security.get("risk_score", 0.0),
            "findings": final_response.gateway.security.get("findings", []),
            "fallback_used": final_response.gateway.fallback_used,
            "attempts": final_response.gateway.attempts,
            "trace_id": final_response.gateway.request_id,
        }

        return {
            "status": "success",
            "http_status": 200,
            "response": final_response.model_dump(),
            "trace_summary": trace_summary,
        }

    except GatewayError as ge:
        is_block = ge.status_code == 403 and ge.code == "blocked_by_policy"
        categories = []
        risk_score = 0.0
        if isinstance(ge.details, dict):
            categories = ge.details.get("categories", [])
            risk_score = ge.details.get("risk_score", 0.9 if is_block else 0.0)

        trace_summary = {
            "request_id": request_id,
            "correlation_id": correlation_id,
            "status": "blocked" if is_block else "error",
            "latency_ms": 0,
            "security_decision": "block" if is_block else "error",
            "risk_score": risk_score,
            "findings": categories,
            "fallback_used": False,
            "attempts": [],
            "trace_id": request_id,
        }

        return {
            "status": "blocked" if is_block else "error",
            "http_status": ge.status_code,
            "error": {
                "code": ge.code,
                "message": ge.message,
                "error_type": ge.error_type,
                "details": ge.details,
            },
            "trace_summary": trace_summary,
        }
