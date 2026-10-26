import re
import unicodedata

from app.core.errors import GatewayError
from app.schemas.chat import ChatCompletionRequest

ZERO_WIDTH = {"\u200b", "\u200c", "\u200d", "\ufeff", "\u2060"}
CONFUSABLES = str.maketrans(
    {"а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "і": "i", "у": "y"}
)


def normalize_request(request: ChatCompletionRequest) -> tuple[ChatCompletionRequest, set[str]]:
    messages = []
    normalization_findings: set[str] = set()
    conversation_started = False
    previous_role: str | None = None
    for message in request.messages:
        if message.role == "system" and conversation_started:
            raise GatewayError(
                422, "invalid_request", "System messages must precede conversation messages."
            )
        if message.role != "system":
            conversation_started = True
        if message.role == "tool" and previous_role != "assistant":
            raise GatewayError(
                422, "invalid_request", "Tool messages must follow an assistant message."
            )
        previous_role = message.role
        cleaned = []
        detector_text = []
        had_confusable = False
        for char in unicodedata.normalize("NFKC", message.content):
            if char in ZERO_WIDTH:
                normalization_findings.add("zero_width_character")
                continue
            if char in "аерсхіу":
                had_confusable = True
            if unicodedata.category(char) == "Cc" and char not in "\n\t":
                continue
            cleaned.append(char)
            detector_text.append(char.translate(CONFUSABLES))
        if not cleaned:
            raise GatewayError(
                422, "invalid_request", "Message content cannot be empty after normalization."
            )
        if had_confusable and re.search(
            r"\b(ignore|reveal|system prompt|previous instructions)\b", "".join(detector_text), re.I
        ):
            normalization_findings.add("unicode_confusable")
        messages.append(message.model_copy(update={"content": "".join(cleaned)}))
    return request.model_copy(update={"messages": messages}), normalization_findings
