import re
import time

from app.security.detectors.base import Detector
from app.security.models import DetectorResult, Span

SECRET_PATTERNS = (
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("generic_api_key", re.compile(r"\b(?:sk|api)[-_][A-Za-z0-9_-]{24,}\b", re.I)),
    ("gateway_key", re.compile(r"\blg(?:a)?_[A-Za-z0-9_-]{12,}\b")),
)


class SecretDetector(Detector):
    name = "secrets.rules"
    category = "secret"

    async def detect(self, text: str) -> DetectorResult:
        started = time.perf_counter()
        spans: list[Span] = []
        reasons: set[str] = set()
        for reason, pattern in SECRET_PATTERNS:
            for match in pattern.finditer(text):
                spans.append(Span(start=match.start(), end=match.end(), entity=reason))
                reasons.add(f"{reason}_detected")
        return DetectorResult(
            detector=self.name,
            category=self.category,
            score=0.95 if spans else 0.0,
            suggested_action="block" if spans else "allow",
            reasons=sorted(reasons),
            spans=sorted(spans, key=lambda item: item.start),
            duration_ms=(time.perf_counter() - started) * 1000,
        )
