from app.core.config import Settings
from app.providers.base import ProviderAdapter
from app.providers.fake_adapter import FakeAdapter
from app.providers.gemini_adapter import GeminiAdapter
from app.providers.groq_adapter import GroqAdapter


def build_registry(settings: Settings) -> dict[str, ProviderAdapter]:
    enabled = {name.strip() for name in settings.providers_enabled.split(",")}
    registry: dict[str, ProviderAdapter] = {}
    if "fake" in enabled:
        registry["fake"] = FakeAdapter()
    if "groq" in enabled:
        registry["groq"] = GroqAdapter(settings.groq_api_key)
    if "gemini" in enabled:
        registry["gemini"] = GeminiAdapter(settings.gemini_api_key)
    return registry
