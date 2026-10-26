from app.providers.base import ProviderAdapter, ProviderCapabilities, ProviderResponse
from app.schemas.chat import ChatCompletionRequest


class FakeAdapter(ProviderAdapter):
    name = "fake"

    async def complete(
        self, request: ChatCompletionRequest, provider_model: str
    ) -> ProviderResponse:
        text = next(
            (message.content for message in reversed(request.messages) if message.role == "user"),
            request.messages[-1].content,
        )
        return ProviderResponse(
            content=f"Fake response: {text}",
            finish_reason="stop",
            prompt_tokens=1,
            completion_tokens=3,
        )

    def capabilities(self, provider_model: str) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_context=32_000,
            supported_parameters=frozenset({"temperature", "top_p", "max_tokens", "stop", "seed"}),
        )

    async def health_probe(self) -> bool:
        return True
