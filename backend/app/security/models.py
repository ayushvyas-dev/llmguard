from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Action = Literal["allow", "flag", "redact", "block", "detector_error"]


class Span(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    entity: str
    message_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def nonempty_range(self) -> "Span":
        if self.end <= self.start:
            raise ValueError("span end must be greater than its start")
        return self


class DetectorFailure(BaseModel):
    code: Literal["timeout", "exception", "invalid_output"]


class DetectorResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detector: str
    category: str
    score: float = Field(ge=0, le=1)
    suggested_action: Literal["allow", "flag", "redact", "block"]
    reasons: list[str] = Field(default_factory=list)
    spans: list[Span] = Field(default_factory=list)
    error: DetectorFailure | None = None
    duration_ms: float = Field(ge=0)

    @field_validator("reasons")
    @classmethod
    def reason_codes_are_stable(cls, values: list[str]) -> list[str]:
        if any(
            not reason or len(reason) > 64 or not reason.replace("_", "").isalnum()
            for reason in values
        ):
            raise ValueError("detector reasons must be stable alphanumeric codes")
        return values


class SecurityDecision(BaseModel):
    action: Action
    risk_score: float = Field(ge=0, le=1)
    findings: list[DetectorResult]
    policy_version: int
    warnings: list[str] = Field(default_factory=list)
    enforce: bool = True
