import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.security.models import Action

UNSAFE_CUSTOM_REGEX = re.compile(r"[+*|()]|\\[1-9]")
CUSTOM_REGEX_BOUNDS = re.compile(r"\{(\d+)(?:,(\d+))?\}")
UNBOUNDED_RANGE = re.compile(r"\{\d+,\}")


class DetectorPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    flag_threshold: float = Field(default=0.3, ge=0, le=1)
    redact_threshold: float = Field(default=0.5, ge=0, le=1)
    block_threshold: float = Field(default=0.8, ge=0, le=1)
    timeout_ms: int = Field(default=250, gt=0, le=10_000)
    on_error: Literal["fail_closed", "fail_open"] = "fail_closed"
    mandatory: bool = True

    @model_validator(mode="after")
    def threshold_order(self) -> "DetectorPolicy":
        if not self.flag_threshold <= self.redact_threshold <= self.block_threshold:
            raise ValueError("detector thresholds must be ordered flag <= redact <= block")
        return self


class SecurityPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(default=1, ge=1)
    mode: Literal["enforce", "monitor"] = "enforce"
    max_concurrency: int = Field(default=4, gt=0, le=64)
    store_content: bool = False
    allowed_tools: list[str] = Field(default_factory=list, max_length=16)
    custom_regex_entities: dict[str, str] = Field(default_factory=dict, max_length=32)
    system_prompt_canary: str | None = None
    cacheable: bool = True
    allow_force_cache: bool = True
    detectors: dict[str, DetectorPolicy]

    @model_validator(mode="after")
    def validate_custom_regexes(self) -> "SecurityPolicy":
        unknown = set(self.detectors) - {
            "prompt_injection",
            "jailbreak",
            "pii",
            "secrets",
            "output",
        }
        if unknown:
            raise ValueError(f"unknown detector policies: {', '.join(sorted(unknown))}")
        if len(set(self.allowed_tools)) != len(self.allowed_tools) or any(
            not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) for name in self.allowed_tools
        ):
            raise ValueError("allowed tool names must be unique valid identifiers")
        for name, pattern in self.custom_regex_entities.items():
            # shortcut: simple bounded patterns only; complex rules need a dedicated detector.
            unbounded = UNBOUNDED_RANGE.search(pattern) or any(
                int(lower) > 256 or (upper and int(upper) > 256)
                for lower, upper in CUSTOM_REGEX_BOUNDS.findall(pattern)
            )
            if (
                not name.isidentifier()
                or len(pattern) > 256
                or UNSAFE_CUSTOM_REGEX.search(pattern)
                or unbounded
            ):
                raise ValueError("custom regex entity names or patterns are invalid")
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError("custom regex pattern is invalid") from exc
        return self

    @classmethod
    def default(cls) -> "SecurityPolicy":
        path = Path(__file__).parents[2] / "config" / "default_security_policy.json"
        return cls.model_validate(json.loads(path.read_text()))


class PolicyResolver:
    def __init__(self, default_policy: SecurityPolicy | None = None) -> None:
        self.default_policy = default_policy or SecurityPolicy.default()

    def resolve(self, policy: SecurityPolicy | dict | None = None) -> SecurityPolicy:
        if policy is None:
            return self.default_policy
        return (
            policy if isinstance(policy, SecurityPolicy) else SecurityPolicy.model_validate(policy)
        )

    def revise(self, current: SecurityPolicy, config: dict) -> SecurityPolicy:
        return SecurityPolicy.model_validate({**config, "version": current.version + 1})


def threshold_action(score: float, config: DetectorPolicy) -> Action:
    if score >= config.block_threshold:
        return "block"
    if score >= config.redact_threshold:
        return "redact"
    if score >= config.flag_threshold:
        return "flag"
    return "allow"
