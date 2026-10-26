import re
import time

from app.security.detectors.base import Detector
from app.security.detectors.pii import CARD, EMAIL, IBAN, IPV4, IPV6, PHONE, PIIDetector, luhn_valid
from app.security.detectors.secrets import SECRET_PATTERNS
from app.security.models import DetectorResult, Span

EXFIL = re.compile(r"!\[[^]]*\]\(https?://[^)]*[?&](?:data|token|secret|email)=", re.I)


class OutputDetector(Detector):
    name = "output.rules"
    category = "output_leak"

    def __init__(
        self,
        custom_entities: dict[str, str] | None = None,
        canary: str | None = None,
    ) -> None:
        self.custom_entities = {
            name: re.compile(pattern) for name, pattern in (custom_entities or {}).items()
        }
        self.canary = canary

    async def detect(self, text: str) -> DetectorResult:
        started = time.perf_counter()
        spans: list[Span] = []
        reasons: set[str] = set()
        for entity, pattern, valid in (
            ("email", EMAIL, lambda value: True),
            ("phone", PHONE, lambda value: 7 <= sum(char.isdigit() for char in value) <= 15),
            ("card", CARD, luhn_valid),
            ("iban", IBAN, lambda value: True),
            ("ip", IPV4, PIIDetector._valid_ip),
            ("ip", IPV6, PIIDetector._valid_ip),
        ):
            for match in pattern.finditer(text):
                if valid(match.group()):
                    spans.append(Span(start=match.start(), end=match.end(), entity=entity))
                    reasons.add(f"{entity}_leak")
        for reason, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(text):
                spans.append(Span(start=match.start(), end=match.end(), entity=reason))
                reasons.add(f"{reason}_leak")
        for entity, pattern in self.custom_entities.items():
            for match in pattern.finditer(text):
                spans.append(Span(start=match.start(), end=match.end(), entity=entity))
                reasons.add(f"{entity}_leak")
        if self.canary and self.canary in text:
            reasons.add("system_prompt_canary_leak")
        if EXFIL.search(text):
            reasons.add("markdown_url_exfiltration")
        spans.sort(key=lambda span: span.start)
        return DetectorResult(
            detector=self.name,
            category=self.category,
            score=0.9 if reasons else 0.0,
            suggested_action="block" if reasons else "allow",
            reasons=sorted(reasons),
            spans=spans,
            duration_ms=(time.perf_counter() - started) * 1000,
        )
