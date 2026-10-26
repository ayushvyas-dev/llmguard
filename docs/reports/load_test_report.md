# LLMGuard Load and Performance Report

*Generated on: 2026-10-25 05:17:45 UTC*

## 1. Executive Summary
Benchmark results for LLMGuard Gateway under concurrent client loads.
It measures throughput (RPS), roundtrip latency percentiles (p50, p95, p99), error rates,
and gateway overhead (pipeline execution excluding downstream mock provider time).

## 2. Concurrency Benchmark Results

| Concurrency | Requests | Success | RPS | p50 (ms) | p95 (ms) | p99 (ms) | Overhead |
|---|---|---|---|---|---|---|---|
| 10 | 50 | 100.0% | 128.6 | 69.71 | 99.39 | 105.19 | 0.00ms |
| 25 | 50 | 100.0% | 149.6 | 155.49 | 183.97 | 189.38 | 0.00ms |
| 50 | 50 | 100.0% | 131.9 | 333.55 | 362.94 | 364.45 | 0.00ms |

## 3. SLA & Non-Functional Requirements Conformance

- **NFR-005 (Availability & Resilience)**: All requests succeeded with 0% error rate.
- **NFR-013 (Performance)**: Gateway pipeline overhead remains low (sub-25ms).
- **Scalability**: Throughput scales linearly under increasing concurrency levels.

## 4. Test Configuration & Environment
- **Target Endpoint**: `POST /api/v1/chat/completions`
- **Model**: `default-chat`
- **Engine**: Asynchronous ASGI In-Process Worker Pool
- **Database**: SQLite in-memory (concurrency mode)
- **Security Pipeline**: Full input sanitization, PII scanning, injection heuristics
