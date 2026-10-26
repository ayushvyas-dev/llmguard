from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum

from app.schemas.chat import ChatCompletionRequest, ToolCall


class ProviderErrorCode(StrEnum):
    AUTHENTICATION = "authentication"
    RATE_LIMITED = "rate_limited"
    INVALID_REQUEST = "invalid_request"
    UNAVAILABLE = "unavailable"
    TIMEOUT = "timeout"
    MISCONFIGURED = "misconfigured"


class ProviderError(Exception):
    def __init__(self, code: ProviderErrorCode, message: str = "Provider request failed.") -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ProviderCapabilities:
    max_context: int
    supports_streaming: bool = False
    supports_tools: bool = False
    supports_json_mode: bool = False
    supported_parameters: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ProviderResponse:
    content: str
    finish_reason: str | None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    tool_calls: tuple[ToolCall, ...] = ()


class ProviderAdapter(ABC):
    name: str

    @abstractmethod
    async def complete(
        self, request: ChatCompletionRequest, provider_model: str
    ) -> ProviderResponse: ...

    @abstractmethod
    def capabilities(self, provider_model: str) -> ProviderCapabilities: ...

    @abstractmethod
    async def health_probe(self) -> bool: ...
