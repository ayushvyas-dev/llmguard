"""Unit tests for key generation, hashing and verification."""

from app.auth.keys import generate_key, hash_key, verify_key
from app.core.config import AppEnv


class TestGenerateKey:
    def test_client_key_format(self) -> None:
        full_key, prefix, secret = generate_key(AppEnv.DEVELOPMENT)
        assert full_key.startswith("lg_dev_")
        parts = full_key.split("_", 3)
        assert len(parts) == 4
        assert parts[0] == "lg"
        assert parts[1] == "dev"
        assert parts[2] == prefix
        assert parts[3] == secret

    def test_admin_key_format(self) -> None:
        full_key, prefix, secret = generate_key(AppEnv.DEVELOPMENT, role="admin")
        assert full_key.startswith("lga_dev_")
        parts = full_key.split("_", 3)
        assert parts[0] == "lga"

    def test_production_env_tag(self) -> None:
        full_key, _, _ = generate_key(AppEnv.PRODUCTION)
        assert full_key.startswith("lg_prd_")

    def test_test_env_tag(self) -> None:
        full_key, _, _ = generate_key(AppEnv.TEST)
        assert full_key.startswith("lg_tst_")

    def test_prefix_length(self) -> None:
        _, prefix, _ = generate_key(AppEnv.DEVELOPMENT)
        assert len(prefix) == 8

    def test_secret_has_sufficient_entropy(self) -> None:
        _, _, secret = generate_key(AppEnv.DEVELOPMENT)
        # token_urlsafe(32) produces ~43 chars; we require at least 32
        assert len(secret) >= 32

    def test_keys_are_unique(self) -> None:
        keys = {generate_key(AppEnv.DEVELOPMENT)[0] for _ in range(50)}
        assert len(keys) == 50


class TestHashAndVerify:
    def test_hash_produces_32_bytes(self) -> None:
        h = hash_key("test_secret", "test_pepper")
        assert isinstance(h, bytes)
        assert len(h) == 32  # SHA256 output length

    def test_verify_correct_secret(self) -> None:
        secret = "my_secret_token"
        pepper = "my_pepper_value"
        h = hash_key(secret, pepper)
        assert verify_key(secret, h, pepper) is True

    def test_verify_wrong_secret(self) -> None:
        pepper = "my_pepper_value"
        h = hash_key("correct_secret", pepper)
        assert verify_key("wrong_secret", h, pepper) is False

    def test_verify_wrong_pepper(self) -> None:
        secret = "my_secret_token"
        h = hash_key(secret, "pepper_1")
        assert verify_key(secret, h, "pepper_2") is False

    def test_different_peppers_produce_different_hashes(self) -> None:
        secret = "same_secret"
        h1 = hash_key(secret, "pepper_a")
        h2 = hash_key(secret, "pepper_b")
        assert h1 != h2

    def test_hmac_compare_digest_is_used(self) -> None:
        """Verify verify_key uses hmac.compare_digest (code review check)."""
        import inspect

        from app.auth import keys

        source = inspect.getsource(keys.verify_key)
        assert "hmac.compare_digest" in source
