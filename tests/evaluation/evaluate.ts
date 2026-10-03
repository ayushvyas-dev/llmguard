import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInjection } from '../../src/modules/prompt-injection/injection.detector.js';
import { detectPii } from '../../src/modules/pii/pii.detector.js';
import { normalizeForSecurity } from '../../src/modules/normalization/normalize.js';
import { validateToolCall } from '../../src/modules/tool-security/tool-validator.js';
import { classifySecurity } from '../../src/integrations/groq/security-classifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures');

export interface MetricResult {
  category: string;
  totalSamples: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  approximateCostPerReqUsd: number | null;
}

function calculatePercentile(latencies: number[], percentile: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  const clampedIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return Number((sorted[clampedIndex] ?? 0).toFixed(2));
}

export async function runEvaluation(): Promise<Record<string, MetricResult>> {
  const maliciousPrompts: string[] = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'malicious-prompts.json'), 'utf8'),
  );
  const benignPrompts: string[] = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'benign-prompts.json'), 'utf8'),
  );
  const adversarial: { malicious: string[]; benign: string[] } = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'adversarial-prompts.json'), 'utf8'));
  maliciousPrompts.push(...adversarial.malicious);
  benignPrompts.push(...adversarial.benign);
  const piiInputs: Array<{ text: string; expectedSubtype: string }> = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'pii-inputs.json'), 'utf8'),
  );
  const toolCalls: { safe: any[]; dangerous: any[] } = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'tool-calls.json'), 'utf8'),
  );

  const results: Record<string, MetricResult> = {};

  // 1. Evaluate Prompt Injection Detection
  {
    const latencies: number[] = [];
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;

    for (const prompt of maliciousPrompts) {
      const start = performance.now();
      const res = detectInjection(normalizeForSecurity(prompt).text);
      latencies.push(performance.now() - start);

      if (res.isInjection) tp++;
      else fn++;
    }

    for (const prompt of benignPrompts) {
      const start = performance.now();
      const res = detectInjection(normalizeForSecurity(prompt).text);
      latencies.push(performance.now() - start);

      if (res.isInjection) fp++;
      else tn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
    const fnr = tp + fn > 0 ? fn / (tp + fn) : 0;

    results['prompt_injection'] = {
      category: 'Prompt Injection',
      totalSamples: maliciousPrompts.length + benignPrompts.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      falsePositiveRate: Number(fpr.toFixed(4)),
      falseNegativeRate: Number(fnr.toFixed(4)),
      medianLatencyMs: calculatePercentile(latencies, 50),
      p95LatencyMs: calculatePercentile(latencies, 95),
      approximateCostPerReqUsd: 0.0, // Rule-based: $0.00
    };

    // Live comparison is opt-in because it incurs provider cost and latency.
    if (process.env['EVAL_SEMANTIC'] === '1') {
      const samples = [...maliciousPrompts.map((content) => ({ content, label: true })), ...benignPrompts.map((content) => ({ content, label: false }))];
      const semanticLatencies: number[] = [];
      let semanticErrors = 0;
      let stp = 0; let sfn = 0; let sfp = 0; let stn = 0;
      let invocations = 0;
      for (const sample of samples) {
        const ruleResult = detectInjection(normalizeForSecurity(sample.content).text).isInjection;
        let semanticResult = false;
        const start = performance.now(); invocations++;
        try {
          const result = await classifySecurity({ content: sample.content, source: 'evaluation_fixture', trust: 'untrusted', intendedOperation: 'evaluation' });
          semanticLatencies.push(performance.now() - start);
          semanticResult = result.classification.isInjection && result.classification.confidence >= 0.6;
        } catch { semanticErrors++; }
        const detected = ruleResult || semanticResult;
        if (sample.label && detected) stp++;
        else if (sample.label) sfn++;
        else if (detected) sfp++;
        else stn++;
      }
      const denomP = stp + sfp; const denomR = stp + sfn;
      results['rules_plus_semantic'] = {
        category: 'Rules + semantic classifier (live; union decision)', totalSamples: samples.length,
        truePositives: stp, falsePositives: sfp, trueNegatives: stn, falseNegatives: sfn,
        precision: denomP ? Number((stp / denomP).toFixed(4)) : 0,
        recall: denomR ? Number((stp / denomR).toFixed(4)) : 0,
        falsePositiveRate: stn + sfp ? Number((sfp / (stn + sfp)).toFixed(4)) : 0,
        falseNegativeRate: denomR ? Number((sfn / denomR).toFixed(4)) : 0,
        medianLatencyMs: calculatePercentile(semanticLatencies, 50), p95LatencyMs: calculatePercentile(semanticLatencies, 95),
        approximateCostPerReqUsd: null, invocationCount: invocations, successfulCalls: semanticLatencies.length, failures: semanticErrors,
        estimatedCost: null, note: 'Set provider-specific token pricing before estimating cost; errors count as rules-only decisions.',
      } as MetricResult;
    } else {
      (results as Record<string, unknown>)['rules_plus_semantic'] = { status: 'not_run', reason: 'Set EVAL_SEMANTIC=1 with GROQ_API_KEY to run paid live comparisons.' };
    }
  }

  // 2. Evaluate PII Detection
  {
    const latencies: number[] = [];
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;

    for (const sample of piiInputs) {
      const start = performance.now();
      const res = detectPii(sample.text);
      latencies.push(performance.now() - start);

      if (res.hasPii) tp++;
      else fn++;
    }

    for (const prompt of benignPrompts.slice(0, 50)) {
      const start = performance.now();
      const res = detectPii(prompt);
      latencies.push(performance.now() - start);

      if (res.hasPii) fp++;
      else tn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
    const fnr = tp + fn > 0 ? fn / (tp + fn) : 0;

    results['pii_detection'] = {
      category: 'PII Detection',
      totalSamples: piiInputs.length + 50,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      falsePositiveRate: Number(fpr.toFixed(4)),
      falseNegativeRate: Number(fnr.toFixed(4)),
      medianLatencyMs: calculatePercentile(latencies, 50),
      p95LatencyMs: calculatePercentile(latencies, 95),
      approximateCostPerReqUsd: 0.0, // Regex-based: $0.00
    };
  }

  // 3. Evaluate Tool Security
  {
    const latencies: number[] = [];
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;

    for (const tool of toolCalls.dangerous) {
      const start = performance.now();
      const res = validateToolCall(tool);
      latencies.push(performance.now() - start);

      if (!res.allowed || res.requiresApproval) tp++;
      else fn++;
    }

    for (const tool of toolCalls.safe) {
      const start = performance.now();
      const res = validateToolCall(tool);
      latencies.push(performance.now() - start);

      if (!res.allowed || res.requiresApproval) fp++;
      else tn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
    const fnr = tp + fn > 0 ? fn / (tp + fn) : 0;

    results['tool_security'] = {
      category: 'Tool Call Security',
      totalSamples: toolCalls.dangerous.length + toolCalls.safe.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      falsePositiveRate: Number(fpr.toFixed(4)),
      falseNegativeRate: Number(fnr.toFixed(4)),
      medianLatencyMs: calculatePercentile(latencies, 50),
      p95LatencyMs: calculatePercentile(latencies, 95),
      approximateCostPerReqUsd: 0.0,
    };
  }

  // Write evaluation report
  const reportPath = path.resolve(process.cwd(), 'evaluation_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  return results;
}

// If executed directly via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('🚀 Running LLM Guard Evaluation Suite...');
  runEvaluation()
    .then((metrics) => {
      console.log('\n📊 LLM Guard Benchmark Evaluation Results:');
      console.table(
        Object.values(metrics).filter((m) => typeof m.precision === 'number').map((m) => ({
          Category: m.category,
          Samples: m.totalSamples,
          Precision: `${(m.precision * 100).toFixed(1)}%`,
          Recall: `${(m.recall * 100).toFixed(1)}%`,
          'FPR': `${(m.falsePositiveRate * 100).toFixed(1)}%`,
          'FNR': `${(m.falseNegativeRate * 100).toFixed(1)}%`,
          'P50 (ms)': `${m.medianLatencyMs} ms`,
          'P95 (ms)': `${m.p95LatencyMs} ms`,
          'Cost/Req': m.approximateCostPerReqUsd === null ? 'not estimated' : `$${m.approximateCostPerReqUsd.toFixed(6)}`,
        })),
      );
      const comparison = (metrics as Record<string, unknown>)['rules_plus_semantic'];
      if (typeof comparison === 'object' && comparison !== null && 'status' in comparison && comparison.status === 'not_run') console.log(`Semantic comparison not run: ${'reason' in comparison ? comparison.reason : ''}`);
      console.log('✅ Evaluation complete! Saved report to evaluation_report.json\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Evaluation suite failed:', err);
      process.exit(1);
    });
}
