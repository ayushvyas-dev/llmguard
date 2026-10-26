from collections.abc import Iterable

from app.security.models import Span


def redact_text(
    text: str,
    spans: Iterable[Span],
    replacements: dict[str, str] | None = None,
    counters: dict[str, int] | None = None,
) -> tuple[str, dict[str, str]]:
    matches = [span for span in spans if span.message_index == 0]
    replacements = replacements if replacements is not None else {}
    counters = counters if counters is not None else {}
    pieces: list[str] = []
    cursor = 0
    for span in sorted(matches, key=lambda item: (item.start, item.end)):
        if span.start < cursor:
            continue
        matched = text[span.start : span.end]
        placeholder = replacements.get(matched)
        if placeholder is None:
            counters[span.entity] = counters.get(span.entity, 0) + 1
            placeholder = f"[{span.entity.upper()}_{counters[span.entity]}]"
            replacements[matched] = placeholder
        pieces.extend((text[cursor : span.start], placeholder))
        cursor = span.end
    pieces.append(text[cursor:])
    return "".join(pieces), replacements
