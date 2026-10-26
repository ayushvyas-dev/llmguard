from typing import Any

from app.providers.base import (
    ProviderAdapter,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCode,
    ProviderResponse,
)
from app.schemas.chat import ChatCompletionRequest, ToolCall


class GroqAdapter(ProviderAdapter):
    name = "groq"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    async def complete(
        self, request: ChatCompletionRequest, provider_model: str
    ) -> ProviderResponse:
        if not self.api_key:
            raise ProviderError(ProviderErrorCode.MISCONFIGURED, "Groq is not configured.")
        from groq import AsyncGroq

        params: dict[str, Any] = {
            "model": provider_model,
            "messages": [message.model_dump(exclude_none=True) for message in request.messages],
        }
        if request.tools:
            params["tools"] = [tool.model_dump(exclude_none=True) for tool in request.tools]
        for name in ("temperature", "top_p", "max_tokens", "stop", "seed"):
            value = getattr(request, name)
            if value is not None:
                params[name] = value
        try:
            response = await AsyncGroq(api_key=self.api_key).chat.completions.create(**params)
        except Exception as exc:
            raise map_groq_error(exc) from exc
        choice = response.choices[0]
        usage = response.usage
        tool_calls = tuple(
            ToolCall(
                id=call.id,
                function={"name": call.function.name, "arguments": call.function.arguments},
            )
            for call in (choice.message.tool_calls or [])
        )
        return ProviderResponse(
            content=choice.message.content or "",
            finish_reason=choice.finish_reason,
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
            tool_calls=tool_calls,
        )

    def capabilities(self, provider_model: str) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context=128_000,
            supports_streaming=True,
            supports_tools=True,
            supports_json_mode=True,
            supported_parameters=frozenset({"temperature", "top_p", "max_tokens", "stop", "seed"}),
        )

    async def health_probe(self) -> bool:
        return bool(self.api_key)


def map_groq_error(exc: Exception) -> ProviderError:
    status_code = getattr(exc, "status_code", None)
    if status_code == 401:
        return ProviderError(ProviderErrorCode.AUTHENTICATION)
    if status_code == 429:
        return ProviderError(ProviderErrorCode.RATE_LIMITED)
    if status_code and 400 <= status_code < 500:
        return ProviderError(ProviderErrorCode.INVALID_REQUEST)
    if isinstance(exc, TimeoutError):
        return ProviderError(ProviderErrorCode.TIMEOUT)
    return ProviderError(ProviderErrorCode.UNAVAILABLE)
