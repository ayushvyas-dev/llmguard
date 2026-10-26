import pytest

from app.core.config import Settings
from app.core.errors import GatewayError
from app.gateway.orchestrator import GatewayOrchestrator
from app.providers.base import ProviderCapabilities
from app.providers.fake_adapter import FakeAdapter
from app.schemas.chat import ChatCompletionRequest, ChatMessage, GatewayOptions


def request(**changes) -> ChatCompletionRequest:
    values = {
        "model": "default-chat",
        "messages": [ChatMessage(role="user", content="Say hello")],
    }
    values.update(changes)
    return ChatCompletionRequest(**values)


async def test_fake_completion_is_normalized() -> None:
    response = await GatewayOrchestrator(Settings()).complete(request(), "req_test", "corr_test")
    assert response.id == "req_test"
    assert response.provider == "fake"
    assert response.choices[0].message.content == "Fake response: Say hello"


async def test_unsupported_parameter_is_rejected() -> None:
    with pytest.raises(GatewayError) as exc_info:
        await GatewayOrchestrator(Settings()).complete(
            request(model="gemini-chat", gateway=GatewayOptions(provider="gemini"), seed=1),
            "req_test",
            "corr_test",
        )
    assert exc_info.value.code == "unsupported_parameter"


async def test_unknown_model_is_rejected() -> None:
    with pytest.raises(GatewayError) as exc_info:
        await GatewayOrchestrator(Settings()).complete(
            request(model="not-a-model"), "req_test", "corr_test"
        )
    assert exc_info.value.code == "model_not_found"


async def test_lenient_mode_drops_unsupported_parameters() -> None:
    settings = Settings(unsupported_parameter_mode="lenient")
    gateway = GatewayOrchestrator(settings)

    class LimitedFakeAdapter(FakeAdapter):
        def capabilities(self, provider_model: str) -> ProviderCapabilities:
            return ProviderCapabilities(max_context=1, supported_parameters=frozenset())

    gateway.providers["fake"] = LimitedFakeAdapter()
    response = await gateway.complete(request(seed=1), "req_test", "corr_test")
    assert response.gateway.warnings == ["Dropped unsupported parameters: seed"]
