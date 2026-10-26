import json
from typing import Any

from app.providers.base import (
    ProviderAdapter,
    ProviderCapabilities,
    ProviderError,
    ProviderErrorCode,
    ProviderResponse,
)
from app.schemas.chat import ChatCompletionRequest, ToolCall


class GeminiAdapter(ProviderAdapter):
    name = "gemini"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    async def complete(
        self, request: ChatCompletionRequest, provider_model: str
    ) -> ProviderResponse:
        if not self.api_key:
            raise ProviderError(ProviderErrorCode.MISCONFIGURED, "Gemini is not configured.")
        from google import genai
        from google.genai import types

        system_instruction = "\n".join(
            message.content for message in request.messages if message.role == "system"
        )
        contents = [
            {
                "role": "model" if message.role == "assistant" else "user",
                "parts": [{"text": message.content}],
            }
            for message in request.messages
            if message.role != "system"
        ]
        config: dict[str, Any] = {
            name: getattr(request, name)
            for name in ("temperature", "top_p")
            if getattr(request, name) is not None
        }
        if request.stop is not None:
            config["stop_sequences"] = request.stop
        if request.max_tokens is not None:
            config["max_output_tokens"] = request.max_tokens
        if system_instruction:
            config["system_instruction"] = system_instruction
        if request.tools:
            config["tools"] = [
                {
                    "function_declarations": [
                        {
                            "name": tool.function.name,
                            "description": tool.function.description or "",
                            "parameters": tool.function.parameters,
                        }
                        for tool in request.tools
                    ]
                }
            ]
        try:
            client = genai.Client(api_key=self.api_key)
            response = await client.aio.models.generate_content(
                model=provider_model,
                contents=contents,
                config=types.GenerateContentConfig(**config),
            )
        except Exception as exc:
            raise map_gemini_error(exc) from exc
        metadata = response.usage_metadata
        function_calls = []
        if response.candidates:
            for part_index, part in enumerate(response.candidates[0].content.parts or []):
                call = part.function_call
                if call:
                    function_calls.append(
                        ToolCall(
                            id=getattr(call, "id", None) or f"call_{part_index}",
                            function={"name": call.name, "arguments": json.dumps(call.args or {})},
                        )
                    )
        return ProviderResponse(
            content=response.text or "",
            finish_reason=(response.candidates[0].finish_reason if response.candidates else None),
            prompt_tokens=(metadata.prompt_token_count if metadata else None),
            completion_tokens=(metadata.candidates_token_count if metadata else None),
            tool_calls=tuple(function_calls),
        )

    def capabilities(self, provider_model: str) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context=1_000_000,
            supports_streaming=True,
            supports_tools=True,
            supports_json_mode=True,
            supported_parameters=frozenset({"temperature", "top_p", "max_tokens", "stop"}),
        )

    async def health_probe(self) -> bool:
        return bool(self.api_key)


def map_gemini_error(exc: Exception) -> ProviderError:
    status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status_code in {401, 403}:
        return ProviderError(ProviderErrorCode.AUTHENTICATION)
    if status_code == 429:
        return ProviderError(ProviderErrorCode.RATE_LIMITED)
    if isinstance(status_code, int) and 400 <= status_code < 500:
        return ProviderError(ProviderErrorCode.INVALID_REQUEST)
    if isinstance(exc, TimeoutError):
        return ProviderError(ProviderErrorCode.TIMEOUT)
    return ProviderError(ProviderErrorCode.UNAVAILABLE)
