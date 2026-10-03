import { describe, it, expect } from 'vitest';
import { runEvaluation } from '../evaluation/evaluate.js';

describe('Benchmark Evaluation Suite', () => {
  it('runs benchmarks and achieves expected performance thresholds', async () => {
    const metrics = await runEvaluation();

    expect(metrics['prompt_injection']).toBeDefined();
    expect(metrics['prompt_injection']?.precision).toBeGreaterThanOrEqual(0.9);
    expect(metrics['prompt_injection']?.falsePositiveRate).toBeLessThan(0.05);
    expect(metrics['prompt_injection']?.p95LatencyMs).toBeLessThan(50);

    expect(metrics['pii_detection']).toBeDefined();
    expect(metrics['pii_detection']?.precision).toBeGreaterThanOrEqual(0.95);
    expect(metrics['pii_detection']?.recall).toBeGreaterThanOrEqual(0.95);

    expect(metrics['tool_security']).toBeDefined();
    expect(metrics['tool_security']?.precision).toBeGreaterThanOrEqual(0.7);
    expect(metrics['tool_security']?.recall).toBeGreaterThanOrEqual(0.75);

    expect(metrics['rules_plus_semantic']).toBeDefined();
  });
});
