import asyncio
from collections.abc import Callable
from typing import Any

from app.core.errors import GatewayError
from app.schemas.chat import ChatCompletionRequest
from app.security.detectors.base import Detector
from app.security.detectors.output import OutputDetector
from app.security.detectors.pii import PIIDetector
from app.security.detectors.rules import JailbreakDetector, PromptInjectionDetector
from app.security.detectors.secrets import SecretDetector
from app.security.models import DetectorFailure, DetectorResult, SecurityDecision
from app.security.normalization import normalize_request
from app.security.policy import DetectorPolicy, PolicyResolver, SecurityPolicy, threshold_action
from app.security.redaction import redact_text
from app.security.tool_calls import validate_calls, validate_definitions

DETECTORS: dict[str, Callable[[], Detector]] = {
    "prompt_injection": PromptInjectionDetector,
    "jailbreak": JailbreakDetector,
    "pii": PIIDetector,
    "secrets": SecretDetector,
    "output": OutputDetector,
}


class SecurityEngine:
    def __init__(
        self, writer: Any = None, resolver: PolicyResolver | None = None, settings: Any = None
    ) -> None:
        self.writer = writer
        self.resolver = resolver or PolicyResolver()
        self.settings = settings

    async def inspect_input(
        self,
        request: ChatCompletionRequest,
        request_id: str,
        policy: SecurityPolicy | dict | None = None,
    ) -> tuple[ChatCompletionRequest, SecurityDecision]:
        normalized, normalization_findings = normalize_request(request)
        resolved = self.resolver.resolve(policy)
        try:
            validate_definitions(
                normalized.tools,
                resolved.allowed_tools,
                getattr(self.settings, "request_max_tool_schema_bytes", 16_384),
            )
        except GatewayError:
            await self._write_tool_event(
                request_id, resolved.version, "block", "tool_definition_denied"
            )
            raise
        decision = await self._run(
            [message.content for message in normalized.messages],
            "input",
            request_id,
            resolved,
        )
        injection_policy = resolved.detectors.get("prompt_injection")
        if normalization_findings and injection_policy and injection_policy.enabled:
            finding = DetectorResult(
                detector="prompt_injection.rules",
                category="prompt_injection",
                score=0.9,
                suggested_action="block",
                reasons=sorted(normalization_findings),
                duration_ms=0,
            )
            decision.findings.append(finding)
            decision.risk_score = max(decision.risk_score, finding.score)
            action_order = {"allow": 0, "flag": 1, "redact": 2, "block": 3}
            new_action = threshold_action(finding.score, injection_policy)
            if action_order[new_action] > action_order[decision.action]:
                decision.action = new_action
            await self._write([finding], decision.policy_version, request_id, "input", resolved)
        if decision.enforce and decision.action == "block":
            raise GatewayError(
                403,
                "blocked_by_policy",
                "The request was blocked by a security policy.",
                "security_error",
                {
                    "categories": sorted(
                        {item.category for item in decision.findings if item.score}
                    ),
                    "policy_version": decision.policy_version,
                },
            )
        if decision.enforce and decision.action == "redact":
            redacted = []
            replacements: dict[str, str] = {}
            counters: dict[str, int] = {}
            for index, message in enumerate(normalized.messages):
                spans = [
                    span.model_copy(update={"message_index": 0})
                    for finding in decision.findings
                    for span in finding.spans
                    if span.message_index == index
                ]
                content, _mapping = redact_text(message.content, spans, replacements, counters)
                redacted.append(message.model_copy(update={"content": content}))
            normalized = normalized.model_copy(update={"messages": redacted})
        return normalized, decision

    async def inspect_output(
        self,
        text: str,
        request_id: str,
        policy: SecurityPolicy | dict | None = None,
        tool_calls=(),
        tool_definitions=None,
    ) -> tuple[str, SecurityDecision]:
        resolved = self.resolver.resolve(policy)
        try:
            validate_calls(
                tool_calls,
                tool_definitions or {},
                resolved.allowed_tools,
                getattr(self.settings, "request_max_tool_argument_bytes", 8_192),
            )
        except GatewayError:
            await self._write_tool_event(request_id, resolved.version, "block", "tool_call_invalid")
            raise
        decision = await self._run([text], "output", request_id, resolved)
        if decision.enforce and decision.action == "block":
            raise GatewayError(
                502,
                "output_blocked",
                "The provider response was blocked by a security policy.",
                "security_error",
            )
        if decision.enforce and decision.action == "redact":
            text, _mapping = redact_text(
                text, [span for finding in decision.findings for span in finding.spans]
            )
        return text, decision

    async def _write_tool_event(
        self,
        request_id: str,
        policy_version: int,
        action: str,
        reason: str,
        direction: str = "tool_call",
    ) -> None:
        if self.writer:
            try:
                await self.writer.write(
                    [
                        {
                            "request_id": request_id,
                            "direction": direction,
                            "category": "tool_call",
                            "action": action,
                            "detector": "tool_calls.schema",
                            "score": 1.0,
                            "reason_codes": [reason],
                            "policy_version": policy_version,
                        }
                    ]
                )
            except Exception as exc:
                raise GatewayError(
                    503,
                    "security_check_unavailable",
                    "Security events could not be recorded.",
                    "security_error",
                ) from exc

    async def _run(
        self, texts: list[str], direction: str, request_id: str, policy: SecurityPolicy
    ) -> SecurityDecision:
        semaphore = asyncio.Semaphore(policy.max_concurrency)
        tasks = []
        for index, text in enumerate(texts):
            for key, detector_factory in DETECTORS.items():
                config = policy.detectors.get(key)
                if not config or not config.enabled:
                    continue
                if (direction == "input" and key == "output") or (
                    direction == "output" and key != "output"
                ):
                    continue
                detector = (
                    PIIDetector(policy.custom_regex_entities)
                    if key == "pii"
                    else OutputDetector(policy.custom_regex_entities, policy.system_prompt_canary)
                    if key == "output"
                    else detector_factory()
                )
                tasks.append(self._detect(semaphore, detector, text, index, config))
        outcomes = await asyncio.gather(*tasks)
        findings: list[DetectorResult] = []
        warnings: list[str] = []
        should_fail_closed = False
        for result, error_code, config in outcomes:
            if error_code:
                error_result = DetectorResult(
                    detector="unknown" if result is None else result.detector,
                    category="detector_error" if result is None else result.category,
                    score=0,
                    suggested_action="allow",
                    reasons=["detector_error"],
                    error=DetectorFailure(code=error_code),
                    duration_ms=0,
                )
                findings.append(error_result)
                if config.mandatory and config.on_error == "fail_closed":
                    should_fail_closed = True
                elif config.mandatory:
                    warnings.append(
                        "A mandatory security detector failed; policy allowed the request."
                    )
                continue
            if result is not None:
                findings.append(result)
        decision = self._aggregate(findings, policy, warnings)
        await self._write(
            [finding for finding in findings if finding.error or finding.score > 0],
            policy.version,
            request_id,
            direction,
            policy,
        )
        if should_fail_closed:
            raise GatewayError(
                503,
                "security_check_unavailable",
                "A required security check is unavailable.",
                "security_error",
            )
        return decision

    async def _detect(
        self,
        semaphore: asyncio.Semaphore,
        detector: Detector,
        text: str,
        index: int,
        config: DetectorPolicy,
    ) -> tuple[DetectorResult | None, str | None, DetectorPolicy]:
        try:
            async with semaphore:
                raw_result = await asyncio.wait_for(
                    detector.detect(text), timeout=config.timeout_ms / 1000
                )
        except TimeoutError:
            return self._error_result(detector, "timeout", config)
        except Exception:
            return self._error_result(detector, "exception", config)
        try:
            result = DetectorResult.model_validate(raw_result.model_dump())
            if any(span.end > len(text) for span in result.spans):
                raise ValueError("detector span is outside the input")
            result.spans = [
                span.model_copy(update={"message_index": index}) for span in result.spans
            ]
            return result, None, config
        except Exception:
            return self._error_result(detector, "invalid_output", config)

    @staticmethod
    def _error_result(
        detector: Detector, error_code: str, config: DetectorPolicy
    ) -> tuple[DetectorResult, str, DetectorPolicy]:
        return (
            DetectorResult(
                detector=detector.name,
                category=detector.category,
                score=0,
                suggested_action="allow",
                reasons=["detector_error"],
                error=DetectorFailure(code=error_code),
                duration_ms=0,
            ),
            error_code,
            config,
        )

    def _aggregate(
        self, findings: list[DetectorResult], policy: SecurityPolicy, warnings: list[str]
    ) -> SecurityDecision:
        action_order = {"allow": 0, "flag": 1, "redact": 2, "block": 3}
        action = "allow"
        for finding in findings:
            config_key = next(
                (key for key, factory in DETECTORS.items() if factory().name == finding.detector),
                None,
            )
            config = policy.detectors.get(config_key) if config_key else None
            if config:
                proposed = threshold_action(finding.score, config)
                if action_order.get(proposed, 0) > action_order[action]:
                    action = proposed
        return SecurityDecision(
            action=action,
            risk_score=max((finding.score for finding in findings), default=0.0),
            findings=findings,
            policy_version=policy.version,
            warnings=warnings,
            enforce=policy.mode == "enforce",
        )

    async def _write(
        self,
        findings: list[DetectorResult],
        policy_version: int,
        request_id: str,
        direction: str,
        policy: SecurityPolicy | None = None,
    ) -> None:
        if not self.writer or not findings:
            return
        rows = []
        for finding in findings:
            if finding.error:
                action = "detector_error"
            else:
                config_key = next(
                    (
                        key
                        for key, factory in DETECTORS.items()
                        if factory().name == finding.detector
                    ),
                    None,
                )
                config = policy.detectors.get(config_key) if policy and config_key else None
                action = threshold_action(finding.score, config) if config else "flag"
                if action == "allow":
                    continue
            rows.append(
                {
                    "request_id": request_id,
                    "direction": direction,
                    "category": finding.category,
                    "action": action,
                    "detector": finding.detector,
                    "score": finding.score,
                    "reason_codes": finding.reasons,
                    "policy_version": policy_version,
                }
            )
        if rows:
            try:
                await self.writer.write(rows)
            except Exception as exc:
                raise GatewayError(
                    503,
                    "security_check_unavailable",
                    "Security events could not be recorded.",
                    "security_error",
                ) from exc
