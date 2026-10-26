import json
from dataclasses import dataclass
from pathlib import Path

from app.core.errors import GatewayError


@dataclass(frozen=True)
class ModelDefinition:
    alias: str
    provider: str
    provider_model_id: str
    capabilities: dict[str, bool]
    enabled: bool


class ModelCatalog:
    def __init__(self, models: list[ModelDefinition]) -> None:
        self.models = {model.alias: model for model in models}

    @classmethod
    def from_seed(cls) -> "ModelCatalog":
        seed_path = Path(__file__).parents[2] / "config" / "models_seed.json"
        rows = json.loads(seed_path.read_text())
        return cls([ModelDefinition(**row) for row in rows])

    def resolve(self, alias: str, provider: str | None = None) -> ModelDefinition:
        model = self.models.get(alias) or next(
            (
                candidate
                for candidate in self.models.values()
                if candidate.provider_model_id == alias
            ),
            None,
        )
        if not model or not model.enabled:
            raise GatewayError(404, "model_not_found", "The requested model was not found.")
        if provider and model.provider != provider:
            raise GatewayError(404, "model_not_found", "The requested model was not found.")
        return model
