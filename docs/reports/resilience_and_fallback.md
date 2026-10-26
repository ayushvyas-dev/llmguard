# Failure Injection and Resilience Report

## Summary Metrics
- **Total Scenarios Evaluated**: 4
- **Direct Successes**: 1
- **Fallbacks Triggered**: 3
- **Fallbacks Succeeded**: 2
- **Fallback Success Rate**: 66.67%
- **Overall Request Success Rate**: 75.00%

## Scenario Breakdown
| Scenario | Outcome | Fallback Used | Attempts |
|---|---|---|---|
| `clean_success` | direct_success | False | 1 |
| `primary_transient_fallback_ok` | fallback_success | True | 2 |
| `primary_server_error_fallback_ok` | fallback_success | True | 2 |
| `both_primary_and_fallback_fail` | total_failure | True | 10 |
## Observations & Resilience Guarantees
- Primary provider outages cleanly transition to fallback candidates within the deadline budget.
- If all providers fail, a normalized 502/504 error response is returned with full attempt history.
