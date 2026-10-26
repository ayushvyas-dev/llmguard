import random
import time
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.cache.eligibility import is_request_cache_eligible, is_response_cache_eligible
from app.cache.key import build_cache_key
from app.cache.service import CacheBackendError, ResponseCacheService
from app.core.config import Settings
from app.core.errors import GatewayError
from app.observability.recorder import TraceRecorder
from app.observability.writer import TraceWriter
from app.providers.base import ProviderError, ProviderErrorCode
from app.providers.catalog import ModelCatalog
from app.providers.registry import build_registry
from app.routing.policy import RoutingPolicy, resolve_routing_policy
from app.routing.router import GatewayRouter
from app.schemas.chat import (
    AssistantMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    GatewayResponse,
    Usage,
)
from app.security.engine import SecurityEngine
from app.security.models import SecurityDecision
from app.security.policy import SecurityPolicy
from app.security.tool_calls import validate_definitions
from app.usage.pricing import PricingService, estimate_tokens


class GatewayOrchestrator:
    def __init__(
        self,
        settings: Settings,
        catalog: ModelCatalog | None = None,
        security: SecurityEngine | None = None,
        router: GatewayRouter | None = None,
        trace_writer: TraceWriter | None = None,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        cache_service: ResponseCacheService | None = None,
    ) -> None:
        self.settings = settings
        self.catalog = catalog or ModelCatalog.from_seed()
        self.providers = build_registry(settings)
        self.security = security or SecurityEngine()
        self.router = router or GatewayRouter(self.catalog, self.providers)
        self.trace_writer = trace_writer
        self.session_factory = session_factory
        self.cache_service = cache_service or ResponseCacheService(
            default_ttl_seconds=settings.cache_ttl_seconds
        )

    async def complete(
        self,
        request: ChatCompletionRequest,
        request_id: str,
        correlation_id: str,
        policy: SecurityPolicy | dict | None = None,
        routing_policy: RoutingPolicy | dict | None = None,
        client_allowed_models: list[str] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
        rng: random.Random | None = None,
        recorder: TraceRecorder | None = None,
        client_id: UUID | None = None,
        store_content: bool = False,
        trace_writer: TraceWriter | None = None,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        cache_service: ResponseCacheService | None = None,
    ) -> ChatCompletionResponse:
        active_trace_writer = trace_writer or self.trace_writer
        active_session_factory = session_factory or self.session_factory
        active_cache_service = cache_service or self.cache_service
        prompt_text = "\n".join(m.content for m in request.messages if m.content)
        if recorder is None:
            recorder = TraceRecorder(
                request_id=request_id,
                correlation_id=correlation_id,
                client_id=client_id,
                store_content=store_content,
                max_events=self.settings.trace_max_events,
                max_bytes=self.settings.trace_max_bytes,
                content_retention_days=self.settings.content_storage_retention_days,
            )

        t_sec_in = time.perf_counter()
        try:
            self._validate_limits(request)
            request, input_security = await self.security.inspect_input(
                request, request_id, policy=policy
            )
            recorder.record_event(
                "security_input",
                duration_ms=int((time.perf_counter() - t_sec_in) * 1000),
                outcome="ok",
            )
        except GatewayError as e:
            dur = int((time.perf_counter() - t_sec_in) * 1000)
            is_block = e.status_code == 403 and e.code == "blocked_by_policy"
            outcome = "blocked" if is_block else "error"
            recorder.record_event(
                "security_input",
                duration_ms=dur,
                outcome=outcome,
                attributes={"error": e.code},
            )
            recorder.record_event(
                "response_sent",
                outcome=outcome,
                attributes={"http_status": e.status_code},
            )
            preview_prompt = prompt_text if not is_block else "[BLOCKED PROMPT]"
            trace = recorder.build_trace(
                status="blocked" if is_block else "error",
                http_status=e.status_code,
                error_code=e.code,
                security_decision="block" if is_block else None,
                prompt_text=preview_prompt,
            )
            usage = recorder.build_usage(
                status="blocked" if is_block else "error",
                tokens_source="missing",
            )
            if active_trace_writer:
                await active_trace_writer.write(trace, usage, force_sync=is_block)
            raise

        primary_model = self.catalog.resolve(request.model, request.gateway.provider)
        provider = self.providers.get(primary_model.provider)
        warnings = list(input_security.warnings)

        cache_mode = request.gateway.cache
        cache_status = "miss"
        cache_key = None
        eligible_for_cache = False

        resolved_policy = (
            policy if isinstance(policy, SecurityPolicy) else self.security.resolver.resolve(policy)
        )

        if not self.settings.cache_enabled:
            recorder.record_event(
                "cache_lookup", outcome="bypass", attributes={"reason": "cache_disabled"}
            )
            cache_status = "bypass"
        elif cache_mode == "bypass":
            recorder.record_event("cache_lookup", outcome="bypass", attributes={"mode": "bypass"})
            cache_status = "bypass"
        else:
            is_eligible, inelig_reason = is_request_cache_eligible(
                request, policy=resolved_policy, input_decision=input_security
            )
            if not is_eligible:
                recorder.record_event(
                    "cache_lookup", outcome="ineligible", attributes={"reason": inelig_reason}
                )
                cache_status = "ineligible"
            else:
                eligible_for_cache = True
                cache_key = build_cache_key(
                    client_id=client_id,
                    policy_version=resolved_policy.version,
                    routing_version=self.settings.routing_version,
                    provider=primary_model.provider,
                    provider_model=primary_model.provider_model_id,
                    messages=request.messages,
                    generation_params={
                        "temperature": request.temperature,
                        "top_p": request.top_p,
                        "max_tokens": request.max_tokens,
                        "stop": request.stop,
                        "seed": request.seed,
                    },
                    tools=request.tools,
                    cache_schema_version=self.settings.cache_schema_version,
                )

                if cache_mode == "refresh":
                    recorder.record_event(
                        "cache_lookup", outcome="refresh", attributes={"mode": "refresh"}
                    )
                    cache_status = "miss"
                else:
                    t_cache = time.perf_counter()
                    try:
                        cached_entry = await active_cache_service.get(cache_key)
                    except CacheBackendError as err:
                        recorder.record_event(
                            "cache_lookup",
                            duration_ms=int((time.perf_counter() - t_cache) * 1000),
                            outcome="error",
                            attributes={"error": str(err)},
                        )
                        cache_status = "error"
                        cached_entry = None

                    if cached_entry is not None:
                        # CACHE HIT!
                        recorder.record_event(
                            "cache_lookup",
                            duration_ms=int((time.perf_counter() - t_cache) * 1000),
                            outcome="hit",
                            attributes={"key": cache_key},
                        )
                        cache_status = "hit"
                        recorder.record_event(
                            "usage_recorded", outcome="ok", attributes={"cache_hit": True}
                        )
                        recorder.record_event(
                            "response_sent", outcome="hit", attributes={"http_status": 200}
                        )

                        cached_choices = [
                            Choice(
                                index=c.get("index", 0),
                                message=AssistantMessage(**c["message"]),
                                finish_reason=c.get("finish_reason", "stop"),
                            )
                            for c in cached_entry.get("choices", [])
                        ]
                        cached_usage = cached_entry.get("usage") or {}
                        saved_tokens = cached_usage.get("total_tokens") or 0
                        tokens_source = cached_usage.get("tokens_source", "provider")
                        hit_output = cached_choices[0].message.content if cached_choices else ""

                        latency_ms = int((time.perf_counter() - recorder.start_mono) * 1000)
                        sec_summary = {
                            "decision": input_security.action,
                            "risk_score": input_security.risk_score,
                            "policy_version": resolved_policy.version,
                        }

                        trace = recorder.build_trace(
                            status="success",
                            http_status=200,
                            provider=primary_model.provider,
                            provider_model=primary_model.provider_model_id,
                            fallback_used=False,
                            retry_count=0,
                            latency_ms=latency_ms,
                            security_decision=sec_summary["decision"],
                            risk_score=sec_summary["risk_score"],
                            policy_version=sec_summary["policy_version"],
                            cache_status="hit",
                            prompt_text=prompt_text if store_content else None,
                            output_text=hit_output if store_content else None,
                        )
                        usage = recorder.build_usage(
                            status="success",
                            provider=primary_model.provider,
                            provider_model=primary_model.provider_model_id,
                            input_tokens=0,
                            output_tokens=0,
                            tokens_source=tokens_source,
                            estimated_cost=Decimal("0.0"),
                            cost_status="zero_cached",
                            cache_hit=True,
                            saved_tokens=saved_tokens,
                            latency_ms=latency_ms,
                        )
                        if active_trace_writer:
                            await active_trace_writer.write(trace, usage)

                        return ChatCompletionResponse(
                            id=request_id,
                            created=int(datetime.now(UTC).timestamp()),
                            model=primary_model.alias,
                            provider=primary_model.provider,
                            provider_model=primary_model.provider_model_id,
                            choices=cached_choices,
                            usage=Usage(
                                prompt_tokens=cached_usage.get("prompt_tokens", 0),
                                completion_tokens=cached_usage.get("completion_tokens", 0),
                                total_tokens=saved_tokens,
                                tokens_source=tokens_source,
                                estimated_cost_usd=0.0,
                                cost_is_estimate=True,
                            ),
                            gateway=GatewayResponse(
                                request_id=request_id,
                                correlation_id=correlation_id,
                                latency_ms=latency_ms,
                                cache={"status": "hit"},
                                fallback_used=False,
                                attempts=[],
                                warnings=warnings,
                                security=sec_summary,
                            ),
                        )
                    elif cache_status != "error":
                        recorder.record_event(
                            "cache_lookup",
                            duration_ms=int((time.perf_counter() - t_cache) * 1000),
                            outcome="miss",
                        )
                        cache_status = "miss"

        recorder.record_event("route_select", outcome="ok", attributes={"model": request.model})

        resolved_routing = (
            routing_policy
            if isinstance(routing_policy, RoutingPolicy)
            else resolve_routing_policy(routing_policy, self.settings)
        )

        # Pre-validate requested model parameters
        primary_model = self.catalog.resolve(request.model, request.gateway.provider)
        provider = self.providers.get(primary_model.provider)
        warnings = list(input_security.warnings)
        if provider:
            capabilities = provider.capabilities(primary_model.provider_model_id)
            if request.stream and not capabilities.supports_streaming:
                raise GatewayError(
                    422, "streaming_not_supported", "Streaming is not supported for this model."
                )
            if request.tools and not capabilities.supports_tools:
                raise GatewayError(
                    422, "unsupported_parameter", "Tools are not supported for this model."
                )
            unsupported = [
                name
                for name in ("temperature", "top_p", "max_tokens", "stop", "seed")
                if getattr(request, name) is not None
                and name not in capabilities.supported_parameters
            ]
            if unsupported and self.settings.unsupported_parameter_mode == "strict":
                raise GatewayError(
                    422,
                    "unsupported_parameter",
                    "A requested parameter is not supported for this model.",
                    details={"parameters": unsupported},
                )
            if unsupported:
                request = request.model_copy(update={name: None for name in unsupported})
                warnings.append(f"Dropped unsupported parameters: {', '.join(unsupported)}")

        started = time.perf_counter()

        # Execute call via GatewayRouter (handles candidate selection, retries, jitter, fallback)
        try:
            routing_result = await self.router.execute(
                request=request,
                policy=resolved_routing,
                client_allowed_models=client_allowed_models,
                rng=rng,
                is_cancelled=is_cancelled,
            )
        except GatewayError as e:
            trace_status = "client_cancelled" if e.status_code == 499 else "error"
            attempts = (
                e.details.get("attempts", [])
                if hasattr(e, "details") and isinstance(e.details, dict)
                else []
            )
            for att in attempts:
                recorder.record_event(
                    "provider_attempt",
                    duration_ms=att.get("duration_ms", 0),
                    outcome=att.get("status", "error"),
                    attributes={"provider": att.get("provider"), "model": att.get("model")},
                )
            recorder.record_event(
                "response_sent",
                outcome=trace_status,
                attributes={"http_status": e.status_code},
            )
            trace = recorder.build_trace(
                status=trace_status,
                http_status=e.status_code,
                error_code=e.code,
                retry_count=max(0, len(attempts) - 1) if attempts else 0,
                prompt_text=prompt_text,
            )
            usage = recorder.build_usage(
                status=trace_status,
                tokens_source="missing",
            )
            if active_trace_writer:
                await active_trace_writer.write(trace, usage)
            raise

        provider_response = routing_result.response
        model = routing_result.model
        attempts = routing_result.attempts
        fallback_used = routing_result.fallback_used
        latency_ms = int((time.perf_counter() - started) * 1000)

        for att in attempts:
            recorder.record_event(
                "provider_attempt",
                duration_ms=att.get("duration_ms", 0),
                outcome=att.get("status", "success"),
                attributes={"provider": att.get("provider"), "model": att.get("model")},
            )
        if fallback_used:
            recorder.record_event(
                "fallback",
                outcome="ok",
                attributes={"final_provider": model.provider},
            )
        elif len(attempts) > 1:
            recorder.record_event(
                "retry",
                outcome="ok",
                attributes={"retries": len(attempts) - 1},
            )

        resolved_policy = self.security.resolver.resolve(policy)
        tool_definitions = validate_definitions(
            request.tools,
            resolved_policy.allowed_tools,
            self.settings.request_max_tool_schema_bytes,
        )
        t_sec_out = time.perf_counter()
        output, output_security = await self.security.inspect_output(
            provider_response.content,
            request_id,
            policy=resolved_policy,
            tool_calls=provider_response.tool_calls,
            tool_definitions=tool_definitions,
        )
        warnings.extend(output_security.warnings)
        recorder.record_event(
            "security_output",
            duration_ms=int((time.perf_counter() - t_sec_out) * 1000),
            outcome="ok",
        )

        prompt_tokens = provider_response.prompt_tokens
        completion_tokens = provider_response.completion_tokens
        if prompt_tokens is None:
            prompt_tokens = estimate_tokens(prompt_text)
        if completion_tokens is None:
            completion_tokens = estimate_tokens(output)

        if (
            provider_response.prompt_tokens is not None
            and provider_response.completion_tokens is not None
        ):
            tokens_source = "provider"
        elif prompt_tokens or completion_tokens:
            tokens_source = "estimated"
        else:
            tokens_source = "missing"

        total_tokens = (
            (prompt_tokens or 0) + (completion_tokens or 0)
            if (prompt_tokens or completion_tokens)
            else None
        )

        cost_usd = None
        cost_status = "unpriced"
        if active_session_factory:
            async with active_session_factory() as session:
                pricing_res = await PricingService.calculate_cost(
                    session,
                    provider=model.provider,
                    provider_model=model.provider_model_id,
                    input_tokens=prompt_tokens,
                    output_tokens=completion_tokens,
                )
                cost_usd = pricing_res.estimated_cost
                cost_status = pricing_res.cost_status

        recorder.record_event(
            "usage_recorded",
            outcome="ok",
            attributes={
                "tokens_source": tokens_source,
                "estimated_cost": float(cost_usd) if cost_usd is not None else 0.0,
            },
        )
        recorder.record_event(
            "response_sent",
            outcome="success",
            attributes={"http_status": 200},
        )

        sec_summary = security_summary(input_security, output_security)
        trace = recorder.build_trace(
            status="success",
            http_status=200,
            provider=model.provider,
            provider_model=model.provider_model_id,
            fallback_used=fallback_used,
            retry_count=max(0, len(attempts) - 1) if attempts else 0,
            latency_ms=latency_ms,
            security_decision=sec_summary["decision"],
            risk_score=sec_summary["risk_score"],
            policy_version=sec_summary["policy_version"],
            cache_status=cache_status,
            prompt_text=prompt_text,
            output_text=output,
        )
        usage = recorder.build_usage(
            status="success",
            provider=model.provider,
            provider_model=model.provider_model_id,
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
            tokens_source=tokens_source,
            estimated_cost=cost_usd,
            cost_status=cost_status,
            latency_ms=latency_ms,
        )
        if active_trace_writer:
            await active_trace_writer.write(trace, usage)

        final_response = ChatCompletionResponse(
            id=request_id,
            created=int(datetime.now(UTC).timestamp()),
            model=model.alias,
            provider=model.provider,
            provider_model=model.provider_model_id,
            choices=[
                Choice(
                    message=AssistantMessage(
                        content=output or None,
                        tool_calls=list(provider_response.tool_calls) or None,
                    ),
                    finish_reason=provider_response.finish_reason,
                )
            ],
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                tokens_source=tokens_source,
                estimated_cost_usd=float(cost_usd) if cost_usd is not None else None,
                cost_is_estimate=True,
            ),
            gateway=GatewayResponse(
                request_id=request_id,
                correlation_id=correlation_id,
                latency_ms=latency_ms,
                cache={"status": cache_status},
                fallback_used=fallback_used,
                attempts=attempts,
                warnings=warnings,
                security=sec_summary,
            ),
        )

        resp_eligible, _ = is_response_cache_eligible(
            final_response, output_decision=output_security
        )
        if eligible_for_cache and cache_key and cache_mode != "bypass" and resp_eligible:
            await active_cache_service.set(
                cache_key, final_response, ttl=self.settings.cache_ttl_seconds
            )

        return final_response

    def _validate_limits(self, request: ChatCompletionRequest) -> None:
        if len(request.messages) > self.settings.request_max_messages:
            raise GatewayError(422, "invalid_request", "The request contains too many messages.")
        if any(
            len(message.content) > self.settings.request_max_message_chars
            for message in request.messages
        ):
            raise GatewayError(
                422, "invalid_request", "A message exceeds the configured size limit."
            )
        if request.max_tokens and request.max_tokens > self.settings.request_max_tokens:
            raise GatewayError(422, "invalid_request", "max_tokens exceeds the configured limit.")


def provider_error_to_gateway_error(error: ProviderError) -> GatewayError:
    mapping = {
        ProviderErrorCode.AUTHENTICATION: (502, "provider_misconfigured"),
        ProviderErrorCode.MISCONFIGURED: (502, "provider_misconfigured"),
        ProviderErrorCode.INVALID_REQUEST: (422, "invalid_request"),
        ProviderErrorCode.RATE_LIMITED: (502, "provider_unavailable"),
        ProviderErrorCode.TIMEOUT: (504, "gateway_timeout"),
        ProviderErrorCode.UNAVAILABLE: (502, "provider_unavailable"),
    }
    status, code = mapping[error.code]
    return GatewayError(status, code, "The upstream provider could not complete the request.")


def security_summary(*decisions: SecurityDecision) -> dict[str, object]:
    action_order = {"allow": 0, "flag": 1, "redact": 2, "block": 3}
    action = max((decision.action for decision in decisions), key=action_order.get)
    return {
        "decision": action,
        "risk_score": max((decision.risk_score for decision in decisions), default=0.0),
        "policy_version": max((decision.policy_version for decision in decisions), default=1),
        "findings": sorted(
            {
                finding.category
                for decision in decisions
                for finding in decision.findings
                if finding.score
            }
        ),
    }
