import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_requires_strong_api_key_pepper() -> None:
    with pytest.raises(ValidationError, match="API_KEY_PEPPER"):
        Settings(app_env="production", api_key_pepper=None, _env_file=None)


def test_production_rejects_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_ORIGINS"):
        Settings(app_env="production", api_key_pepper="a" * 32, allowed_origins=["*"])
