# Failure Injection and Resilience Report

**Generated:** 2026-10-28 14:23:20 UTC  
**Git Commit:** `5ca980bcb12ea1c031b6e2f82319975b8f1fa99a`  
**Python:** 3.12.14 | **Platform:** Linux-7.0.0-38-generic-x86_64-with-glibc2.43  

## 1. Executive Summary
This report measures the fault tolerance, timeout enforcement, fallback transitions,
circuit breaker dynamics, and security preservation of the LLMGuard gateway under controlled failure injection.
A total of **100 test executions** were evaluated across **10 failure scenarios**
(10 independent repetitions per scenario).

## 2. Summary Metrics
- **Total Scenarios Evaluated**: 10
- **Total Test Executions**: 100 (10 repetitions per scenario)
- **Direct Successes (Primary Provider)**: 10
- **Fallbacks Triggered**: 80
- **Fallbacks Succeeded**: 50
- **Security Interceptions (Input/Output)**: 20
- **Terminal Failures (Both Providers Down)**: 20
- **Fallback Success Rate (when fallback triggered)**: 62.50%
- **Overall Request Handling Success Rate**: 80.00%

## 3. Scenario Breakdown & Repetition Results

| Scenario | Repetitions | Primary Error / Mode | Expected Outcome | Actual Outcome | Fallback Triggered | Avg Latency (ms) | Success Rate |
|---|---|---|---|---|---|---|---|
| `both_providers_unavailable` | 10 | Primary 503 + Fallback 503 | `total_failure` | `total_failure` | True | 336.34ms | 0.0% |
| `circuit_breaker_trip_and_recovery` | 10 | Circuit Breaker OPEN | `fallback_success` | `fallback_success` | True | 323.09ms | 100.0% |
| `clean_primary_success` | 10 | None (Healthy) | `direct_success` | `direct_success` | False | 1.07ms | 100.0% |
| `fallback_provider_fails` | 10 | Primary 503 + Fallback 500 | `total_failure` | `total_failure` | True | 336.36ms | 0.0% |
| `primary_rate_limited_429_fallback_ok` | 10 | 429 Rate Limited | `fallback_success` | `fallback_success` | True | 322.63ms | 100.0% |
| `primary_server_error_500_fallback_ok` | 10 | 500 Internal Error | `fallback_success` | `fallback_success` | True | 322.70ms | 100.0% |
| `primary_timeout_fallback_ok` | 10 | Per-attempt Timeout | `fallback_success` | `fallback_success` | True | 1323.97ms | 100.0% |
| `primary_unavailable_503_fallback_ok` | 10 | 503 Unavailable | `fallback_success` | `fallback_success` | True | 322.79ms | 100.0% |
| `security_checks_preserved_on_fallback_output` | 10 | Fallback Secret Leak | `output_blocked` | `output_blocked_by_security` | True | 322.11ms | 100.0% |
| `security_checks_preserved_on_input` | 10 | Malicious Prompt | `blocked_by_security` | `blocked_by_security` | False | 0.56ms | 100.0% |

## 4. Historical Comparison against Baseline

The historical resilience report (2026-10-25) tested only 4 single-iteration scenarios.
The current evaluation tests 10 scenarios with 10 repetitions each (100 total executions),
measuring recovery latency and validating security preservation.

| Metric | Historical Baseline (2026-10-25) | Current Measured Benchmark (2026-10-28) |
|---|---|---|
| **Scenarios Evaluated** | 4 scenarios | **10 scenarios** |
| **Total Executions** | 4 single runs | **100 runs (10 reps each)** |
| **Fallback Success Rate** | 66.67% | **62.50%** |
| **Overall Request Success Rate** | 75.00% | **80.00%** |
| **Timeout Enforcement** | Unmeasured | **Verified (bounded per-attempt timeout)** |
| **Circuit Breaker OPEN Transition** | Unmeasured | **Verified (trips after threshold, 0ms fast-skip)** |
| **Input Security Preservation** | Unmeasured | **Verified (100% blocked before provider call)** |
| **Output Security Preservation** | Unmeasured | **Verified (100% blocked on fallback output leak)** |

## 5. Key Resilience Guarantees & Findings

1. **Zero Security Bypass Under Fallback**:
   - Fallback routing occurs within the gateway's internal orchestrator and **never bypasses security policies**.
   - Input prompt inspection occurs before candidate selection; blocked requests generate 0 provider calls.
   - Output guardrails inspect fallback completions identically to primary completions, catching downstream leaks.

2. **Adaptive Circuit Breakers**:
   - When a provider experiences repeated failures, the breaker trips to `OPEN` state.
   - Subsequent requests bypass the failing provider instantly with `0ms` delay (`circuit_open`), saving latency budgets.

3. **Deadline Budget & Timeout Enforcement**:
   - Under primary timeouts, the router respects per-attempt timeouts and falls back seamlessly within the overall deadline.

4. **Normalized Error Responses**:
   - When both primary and fallback providers are exhausted, the gateway returns standardized 502/504 errors
     with structured failure histories in `details.attempts` without leaking upstream secrets.

## 6. Reproducibility Instructions
To reproduce the resilience benchmark suite:
```bash
cd backend
uv run python -m tests.resilience.run_resilience_benchmark --report ../docs/reports/resilience_and_fallback.md
```
