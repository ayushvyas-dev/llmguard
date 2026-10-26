"""Locust load testing suite for LLMGuard Gateway (B8, NFR-005, NFR-013).

Simulates concurrent traffic patterns across chat completion, caching, and health probes.
"""

import os

from locust import HttpUser, between, task

DEFAULT_KEY = os.environ.get("LLMGUARD_API_KEY", "lg_dev_testkey_1234567890abcdef")


class GatewayLoadUser(HttpUser):
    """Simulates realistic API client traffic against the LLMGuard Gateway."""

    wait_time = between(0.01, 0.05)

    def on_start(self) -> None:
        """Set up authorization header."""
        self.headers = {
            "Authorization": f"Bearer {DEFAULT_KEY}",
            "Content-Type": "application/json",
        }

    @task(70)
    def chat_completion(self) -> None:
        """Primary chat completion endpoint traffic."""
        payload = {
            "model": "default-chat",
            "messages": [
                {"role": "user", "content": "Explain quantum computing in one short sentence."}
            ],
            "temperature": 0.0,
            "gateway": {
                "cache": "bypass",
                "allow_fallback": True,
            },
        }
        with self.client.post(
            "/api/v1/chat/completions",
            json=payload,
            headers=self.headers,
            catch_response=True,
            name="/api/v1/chat/completions",
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}: {response.text}")

    @task(20)
    def chat_cached_completion(self) -> None:
        """Cached chat completions to measure cache hit performance and gateway latency."""
        payload = {
            "model": "default-chat",
            "messages": [{"role": "user", "content": "What is the capital of France?"}],
            "temperature": 0.0,
            "gateway": {
                "cache": "default",
                "allow_fallback": False,
            },
        }
        with self.client.post(
            "/api/v1/chat/completions",
            json=payload,
            headers=self.headers,
            catch_response=True,
            name="/api/v1/chat/completions [cached]",
        ) as response:
            if response.status_code == 200:
                response.success()
            else:
                response.failure(f"Status {response.status_code}: {response.text}")

    @task(10)
    def health_check(self) -> None:
        """Liveness probe check."""
        self.client.get("/api/v1/health", name="/api/v1/health")
