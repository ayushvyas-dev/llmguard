from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.admin.router import router as admin_router
from app.api.v1.chat import router as chat_router
from app.api.v1.health import router as health_router
from app.cache.service import ResponseCacheService
from app.core.config import Settings, get_settings
from app.core.errors import (
    GatewayError,
    error_response,
    gateway_error_handler,
    http_error_handler,
    unhandled_error_handler,
)
from app.db.session import make_engine, make_session_factory
from app.gateway.orchestrator import GatewayOrchestrator
from app.middleware.request_context import RequestContextMiddleware
from app.middleware.size_limit import BodySizeLimitMiddleware
from app.observability.logging import configure_logging
from app.observability.writer import TraceWriter
from app.ratelimit.limiter import RateLimiter
from app.security.engine import SecurityEngine
from app.security.writer import SecurityEventWriter
from app.usage.pricing import PricingService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if getattr(app.state, "trace_writer", None) is not None:
        app.state.trace_writer.start()

    try:
        async with app.state.session_factory() as session:
            await PricingService.seed_pricing_if_empty(session)
    except Exception:
        pass

    yield

    if getattr(app.state, "trace_writer", None) is not None:
        await app.state.trace_writer.stop()
    if getattr(app.state, "redis", None) is not None:
        await app.state.redis.aclose()
    await app.state.engine.dispose()


def create_app(
    settings: Settings | None = None,
    security_writer=None,
    trace_writer: TraceWriter | None = None,
    cache_service: ResponseCacheService | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    app = FastAPI(title="LLMGuard", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = make_engine(settings)
    app.state.session_factory = make_session_factory(app.state.engine)

    # Initialize Redis client if enabled
    app.state.redis = None
    if settings.redis_enabled and settings.redis_url and not settings.redis_url.startswith("none"):
        try:
            from redis.asyncio import Redis

            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        except Exception:
            app.state.redis = None

    app.state.rate_limiter = RateLimiter(settings, redis_client=app.state.redis)
    app.state.security_engine = SecurityEngine(
        writer=security_writer or SecurityEventWriter(app.state.session_factory), settings=settings
    )
    app.state.trace_writer = trace_writer or TraceWriter(
        session_factory=app.state.session_factory,
        queue_size=settings.trace_queue_size,
        mode=settings.audit_mode,
    )
    app.state.cache_service = cache_service or ResponseCacheService(
        redis_client=app.state.redis,
        default_ttl_seconds=settings.cache_ttl_seconds,
    )
    app.state.orchestrator = GatewayOrchestrator(
        settings,
        security=app.state.security_engine,
        trace_writer=app.state.trace_writer,
        session_factory=app.state.session_factory,
        cache_service=app.state.cache_service,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.request_max_body_bytes)
    app.add_middleware(RequestContextMiddleware)
    app.add_exception_handler(GatewayError, gateway_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            request,
            status_code=422,
            code="invalid_request",
            message="Request validation failed.",
            error_type="invalid_request_error",
            details=exc.errors(),
        )

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(admin_router, prefix="/api/v1")
    return app


app = create_app()
