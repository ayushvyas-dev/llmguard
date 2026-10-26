import ipaddress
import re
import time

from app.security.detectors.base import Detector
from app.security.models import DetectorResult, Span

EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{5,}\d)(?!\w)")
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
IPV6 = re.compile(r"(?<![\w:])[0-9A-F:]{2,39}(?![\w:])", re.I)
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b", re.I)


def luhn_valid(value: str) -> bool:
    digits = [int(char) for char in value if char.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


class PIIDetector(Detector):
    name = "pii.rules"
    category = "pii"

    def __init__(self, custom_entities: dict[str, str] | None = None) -> None:
        self.custom_entities = {
            name: re.compile(pattern) for name, pattern in (custom_entities or {}).items()
        }

    async def detect(self, text: str) -> DetectorResult:
        started = time.perf_counter()
        spans: list[Span] = []
        reasons: set[str] = set()
        candidates = (
            ("email", EMAIL, lambda value: True),
            ("card", CARD, luhn_valid),
            ("ip", IPV4, self._valid_ip),
            ("ip", IPV6, self._valid_ip),
            ("iban", IBAN, lambda value: True),
            ("phone", PHONE, lambda value: 7 <= len(re.sub(r"\D", "", value)) <= 15),
        )
        for entity, pattern, valid in candidates:
            for match in pattern.finditer(text):
                if valid(match.group()):
                    if any(match.start() < span.end and span.start < match.end() for span in spans):
                        continue
                    spans.append(Span(start=match.start(), end=match.end(), entity=entity))
                    reasons.add(f"{entity}_detected")
        for entity, pattern in self.custom_entities.items():
            for match in pattern.finditer(text):
                if not any(match.start() < span.end and span.start < match.end() for span in spans):
                    spans.append(Span(start=match.start(), end=match.end(), entity=entity))
                    reasons.add(f"{entity}_detected")
        spans.sort(key=lambda item: (item.start, item.end))
        return DetectorResult(
            detector=self.name,
            category=self.category,
            score=0.8 if spans else 0.0,
            suggested_action="redact" if spans else "allow",
            reasons=sorted(reasons),
            spans=spans,
            duration_ms=(time.perf_counter() - started) * 1000,
        )

    @staticmethod
    def _valid_ip(value: str) -> bool:
        try:
            ipaddress.ip_address(value)
            return True
        except ValueError:
            return False
