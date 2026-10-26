from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GatewayOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["groq", "gemini", "fake"] | None = None
    allow_fallback: bool = True
    cache: Literal["default", "bypass", "refresh", "force"] = "default"


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["system", "user", "assistant", "tool"]
    content: str = Field(min_length=1)
    tool_call_id: str | None = None
    name: str | None = None


class ToolFunction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=1024)
    parameters: dict = Field(default_factory=dict)


class ToolDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["function"] = "function"
    function: ToolFunction


class ToolCallFunction(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: ToolCallFunction


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str = Field(min_length=1, max_length=255)
    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)
    stop: list[str] | None = Field(default=None, max_length=4)
    seed: int | None = None
    stream: bool = False
    gateway: GatewayOptions = Field(default_factory=GatewayOptions)
    metadata: dict[str, str] = Field(default_factory=dict)
    tools: list[ToolDefinition] | None = Field(default=None, max_length=16)

    @field_validator("stop")
    @classmethod
    def stop_sequences_must_not_be_empty(cls, value: list[str] | None) -> list[str] | None:
        if value and any(not sequence for sequence in value):
            raise ValueError("stop sequences must not be empty")
        return value


class AssistantMessage(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str | None = None
    tool_calls: list[ToolCall] | None = None


class Choice(BaseModel):
    index: int = 0
    message: AssistantMessage
    finish_reason: str | None = None


class Usage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    tokens_source: Literal["provider", "estimated", "missing"] = "missing"
    estimated_cost_usd: float | None = None
    cost_is_estimate: bool = True


class GatewayResponse(BaseModel):
    request_id: str
    correlation_id: str
    latency_ms: int
    cache: dict[str, str] = Field(default_factory=lambda: {"status": "miss"})
    fallback_used: bool = False
    attempts: list[dict[str, str | int]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    security: dict[str, object] = Field(default_factory=dict)


class ChatCompletionResponse(BaseModel):
    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    provider: str
    provider_model: str
    choices: list[Choice]
    usage: Usage
    gateway: GatewayResponse
