import pytest

from app.providers.base import ProviderErrorCode
from app.providers.gemini_adapter import map_gemini_error
from app.providers.groq_adapter import map_groq_error


class ProviderException(Exception):
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, ProviderErrorCode.AUTHENTICATION),
        (429, ProviderErrorCode.RATE_LIMITED),
        (400, ProviderErrorCode.INVALID_REQUEST),
        (500, ProviderErrorCode.UNAVAILABLE),
    ],
)
def test_groq_errors_map_to_normalized_categories(status: int, code: ProviderErrorCode) -> None:
    assert map_groq_error(ProviderException(status)).code is code


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (403, ProviderErrorCode.AUTHENTICATION),
        (429, ProviderErrorCode.RATE_LIMITED),
        (400, ProviderErrorCode.INVALID_REQUEST),
        (500, ProviderErrorCode.UNAVAILABLE),
    ],
)
def test_gemini_errors_map_to_normalized_categories(status: int, code: ProviderErrorCode) -> None:
    assert map_gemini_error(ProviderException(status)).code is code
