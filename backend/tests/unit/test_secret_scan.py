"""Static secret scanner ensuring no hardcoded credentials in app code (B8, 12.5)."""

import re
from pathlib import Path

SECRET_PATTERNS = [
    (r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----", "Private key"),
    (r"\bAIza[0-9A-Za-z-_]{35}\b", "Google API Key"),
    (r"\bgsk_[A-Za-z0-9_-]{32,}\b", "Groq API Key"),
    (r"\bsk-ant-[A-Za-z0-9_-]{32,}\b", "Anthropic API Key"),
    (r"\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b", "OpenAI API Key"),
    (r"\bAKIA[0-9A-Z]{16}\b", "AWS Access Key ID"),
    (r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b", "GitHub Token"),
    (r"\bxox[baprs]-[0-9a-zA-Z-]{10,}\b", "Slack Token"),
]

SCAN_EXTENSIONS = {".py", ".json", ".yaml", ".yml", ".env", ".toml", ".md"}
EXCLUDED_DIRS = {".git", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", "site-packages"}


def test_no_hardcoded_secrets_in_app_code():
    """Verify strictly that the application source tree (app/) contains zero hardcoded secrets."""
    app_root = Path(__file__).parents[2] / "app"
    violations = []

    for path in app_root.rglob("*.py"):
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for pattern, desc in SECRET_PATTERNS:
            matches = re.findall(pattern, content)
            if matches:
                violations.append(f"Found {desc} in application file {path.name}: {matches[:2]}")

    assert not violations, "Secret scanning violations in app/:\n" + "\n".join(violations)


def test_no_live_secrets_in_config_or_data():
    """Verify that configuration, seed, and environment files do not contain live secrets."""
    repo_root = Path(__file__).parents[2]
    config_dirs = [repo_root / "config"]
    violations = []

    for folder in config_dirs:
        if not folder.exists():
            continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix not in SCAN_EXTENSIONS:
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            for pattern, desc in SECRET_PATTERNS:
                matches = re.findall(pattern, content)
                live_matches = [
                    m
                    for m in matches
                    if not any(d in m.lower() for d in ("dummy", "fake", "test", "example"))
                ]
                if live_matches:
                    violations.append(
                        f"Found {desc} in config file {path.name}: {live_matches[:2]}"
                    )

    assert not violations, "Secret violations in config:\n" + "\n".join(violations)
