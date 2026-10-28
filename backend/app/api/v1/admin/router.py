"""Admin API router combining clients, keys, policies, and provider health."""

from fastapi import APIRouter, Depends, Request

from app.api.v1.admin.clients import router as clients_router
from app.api.v1.admin.keys import router as keys_router
from app.api.v1.admin.playground import router as playground_router
from app.api.v1.admin.policies import router as policies_router
from app.api.v1.admin.security import router as security_router
from app.api.v1.admin.traces import router as traces_router
from app.api.v1.admin.usage import router as usage_router
from app.auth.dependencies import require_admin_auth
from app.auth.service import AuthResult

router = APIRouter(prefix="/admin")
router.include_router(clients_router)
router.include_router(keys_router)
router.include_router(playground_router)
router.include_router(policies_router)
router.include_router(traces_router)
router.include_router(security_router)
router.include_router(usage_router)


@router.get("/system/mode", tags=["admin-system"])
async def get_system_mode(
    request: Request,
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Return whether the gateway is running in demo mode."""
    settings = getattr(request.app.state, "settings", None)
    demo_mode = getattr(settings, "demo_mode", False) if settings else False
    if _admin.prefix == "demo0000":
        demo_mode = True
    return {"demo_mode": bool(demo_mode)}


@router.get("/providers/health", tags=["admin-providers"])
async def get_providers_health(
    request: Request,
    _admin: AuthResult = Depends(require_admin_auth),
) -> dict:
    """Return circuit breaker status, rolling health metrics, and success rates."""
    router = request.app.state.orchestrator.router
    metrics = await router.health_tracker.get_metrics()
    circuit_states = await router.breaker.get_all_states()

    for key, c_state in circuit_states.items():
        prov, mod = key.split(":", 1)
        if prov not in metrics:
            metrics[prov] = {}
        if mod not in metrics[prov]:
            metrics[prov][mod] = {
                "total_requests": 0,
                "successful_requests": 0,
                "failed_requests": 0,
                "success_rate": 1.0,
                "avg_latency_ms": 0.0,
                "error_counts": {},
            }
        metrics[prov][mod]["circuit_state"] = c_state

    for models in metrics.values():
        for stats in models.values():
            if "circuit_state" not in stats:
                stats["circuit_state"] = "closed"

    return metrics
