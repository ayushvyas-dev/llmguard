import pytest

from app.providers.base import ProviderError, ProviderErrorCode
from app.providers.fake_adapter import FakeAdapter
from app.providers.gemini_adapter import GeminiAdapter
from app.providers.groq_adapter import GroqAdapter
from app.schemas.chat import ChatCompletionRequest, ChatMessage


def request() -> ChatCompletionRequest:
    return ChatCompletionRequest(
        model="default-chat", messages=[ChatMessage(role="user", content="Hello")]
    )


@pytest.mark.parametrize(
    ("adapter", "model"),
    [
        (FakeAdapter(), "fake-chat"),
        (GroqAdapter(None), "groq-chat"),
        (GeminiAdapter(None), "gemini-chat"),
    ],
)
async def test_adapter_contract(adapter, model: str) -> None:
    capabilities = adapter.capabilities(model)
    assert capabilities.max_context > 0
    if adapter.name == "fake":
        response = await adapter.complete(request(), model)
        assert response.content
    else:
        with pytest.raises(ProviderError) as exc_info:
            await adapter.complete(request(), model)
        assert exc_info.value.code is ProviderErrorCode.MISCONFIGURED
