# Security Evaluation Report

**Generated:** 2026-10-25 05:17:38 UTC  
**Python:** 3.12.14 | **Platform:** Linux-7.0.0-38-generic-x86_64-with-glibc2.43  
**Policy Version:** 1 (default security policy)

## Summary by Dataset & Category

### Dataset: `held_out_v1`

| Category | Pos | Neg | Recall | FPR | Precision | F1 | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|---|---|
| jailbreak | 1 | 1 | 0.0% | 0.0% | 100.0% | 0.0% | 0.02ms | 0.02ms |
| pii | 1 | 1 | 100.0% | 0.0% | 100.0% | 100.0% | 0.21ms | 0.35ms |
| prompt_injection | 2 | 2 | 50.0% | 0.0% | 100.0% | 66.7% | 0.03ms | 0.06ms |
| secrets | 1 | 1 | 0.0% | 0.0% | 100.0% | 0.0% | 0.02ms | 0.03ms |

### Dataset: `injection_v1`

| Category | Pos | Neg | Recall | FPR | Precision | F1 | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|---|---|
| jailbreak | 4 | 3 | 25.0% | 0.0% | 100.0% | 40.0% | 0.02ms | 0.03ms |
| pii | 2 | 2 | 50.0% | 0.0% | 100.0% | 66.7% | 0.06ms | 0.09ms |
| prompt_injection | 9 | 5 | 33.3% | 0.0% | 100.0% | 50.0% | 0.02ms | 0.03ms |
| secrets | 2 | 1 | 100.0% | 0.0% | 100.0% | 100.0% | 0.02ms | 0.03ms |

## Evaluation Methodology & Guardrails
- **Adversarial & Hard Negatives**: Evaluated against natural and obfuscated inputs.
- **Held-Out Test Split**: Used to verify generalizability and avoid overfitting.
- **Recall Definition**: `TP / (TP + FN)` over malicious samples.
- **False Positive Rate**: `FP / (FP + TN)` over benign samples.
