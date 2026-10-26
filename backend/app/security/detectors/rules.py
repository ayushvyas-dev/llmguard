import re
import time

from app.security.detectors.base import Detector
from app.security.models import DetectorResult


class RuleDetector(Detector):
    patterns: tuple[tuple[str, re.Pattern[str]], ...] = ()
    name = ""
    category = ""

    async def detect(self, text: str) -> DetectorResult:
        started = time.perf_counter()
        reasons = [reason for reason, pattern in self.patterns if pattern.search(text)]
        score = min(1.0, 0.8 + 0.1 * (len(reasons) - 1)) if reasons else 0.0
        return DetectorResult(
            detector=self.name,
            category=self.category,
            score=score,
            suggested_action="block" if score else "allow",
            reasons=reasons,
            duration_ms=(time.perf_counter() - started) * 1000,
        )


class PromptInjectionDetector(RuleDetector):
    name = "prompt_injection.rules"
    category = "prompt_injection"
    patterns = (
        (
            "override_instruction_phrase",
            re.compile(
                r"\b(ignore|disregard|forget)\b.{0,50}\b(previous|all|above|prior)\b.{0,30}\b(instructions?|rules?)\b",
                re.I,
            ),
        ),
        (
            "system_prompt_extraction",
            re.compile(
                r"\b(reveal|show|print|repeat|dump|expose)\b.{0,40}"
                r"\b(system prompt|hidden prompt|initial instructions?)\b",
                re.I,
            ),
        ),
        (
            "role_reassignment",
            re.compile(
                r"\b(you are now|act as|pretend to be)\b.{0,40}"
                r"\b(unrestricted|developer|admin|DAN|no limits?)\b",
                re.I,
            ),
        ),
        (
            "delimiter_spoofing",
            re.compile(
                r"(?:<\|im_(?:start|end)\|>|\[/?SYSTEM\]|###\s*(?:system|assistant)\s*:)", re.I
            ),
        ),
        (
            "encoded_payload",
            re.compile(r"\b(?:[A-Fa-f0-9]{48,}|(?:[A-Za-z0-9+/]{4}){16,}={0,2})\b"),
        ),
    )


class JailbreakDetector(RuleDetector):
    name = "jailbreak.rules"
    category = "jailbreak"
    patterns = (
        (
            "unrestricted_persona",
            re.compile(
                r"\b(no restrictions|without restrictions|unfiltered|do anything now|DAN mode)\b",
                re.I,
            ),
        ),
        (
            "hypothetical_wrapper",
            re.compile(
                r"\b(for a story|hypothetically|in a fictional scenario)\b.{0,80}"
                r"\b(bypass|ignore|disable)\b.{0,40}\b(safety|policy|rules)\b",
                re.I,
            ),
        ),
    )
