"""API key generation, hashing and verification.

Key format: lg_<env>_<prefix>_<secret>
  - env:    short environment tag (dev, stg, prd)
  - prefix: 8-char random identifier used for DB lookup (public)
  - secret: 32-byte url-safe random token (private, shown once)

Storage: only the prefix (indexed) and HMAC-SHA256(secret, pepper) are persisted.
Comparison uses hmac.compare_digest for constant-time safety.
"""

import hashlib
import hmac
import secrets

from app.core.config import AppEnv

_ENV_TAGS: dict[AppEnv, str] = {
    AppEnv.DEVELOPMENT: "dev",
    AppEnv.TEST: "tst",
    AppEnv.PRODUCTION: "prd",
}


def generate_key(env: AppEnv, role: str = "client") -> tuple[str, str, str]:
    """Generate a new API key.

    Returns (full_key, prefix, secret).
    The full_key is shown once to the admin; prefix and secret are used internally.
    """
    namespace = "lga" if role == "admin" else "lg"
    env_tag = _ENV_TAGS.get(env, "dev")
    prefix = secrets.token_hex(4)  # 8-char hex prefix (no underscores)
    secret = secrets.token_urlsafe(32)  # ≥32 bytes of entropy
    full_key = f"{namespace}_{env_tag}_{prefix}_{secret}"
    return full_key, prefix, secret


def hash_key(secret: str, pepper: str) -> bytes:
    """Compute HMAC-SHA256(secret, pepper) for storage."""
    return hmac.new(pepper.encode(), secret.encode(), hashlib.sha256).digest()


def verify_key(secret: str, stored_hash: bytes, pepper: str) -> bool:
    """Constant-time comparison of a candidate secret against the stored hash."""
    candidate = hash_key(secret, pepper)
    return hmac.compare_digest(candidate, stored_hash)
