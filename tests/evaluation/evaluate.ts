import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInjection } from '../../src/modules/prompt-injection/injection.detector.js';
import { detectPii } from '../../src/modules/pii/pii.detector.js';
import { validateToolCall } from '../../src/modules/tool-security/tool-validator.js';
import { groqService } from '../../src/integrations/groq/groq.service.js';

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
  approximateCostPerReqUsd: number;
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
  const piiInputs: Array<{ text: string; expectedSubtype: string }> = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'pii-inputs.json'), 'utf8'),
  );
  const toolCalls: { safe: any[]; dangerous: any[] } = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'tool-calls.json'), 'utf8'),
  );
  const claims: { supported: any[]; unsupported: any[] } = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'claims.json'), 'utf8'),
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
      const res = detectInjection(prompt);
      latencies.push(performance.now() - start);

      if (res.isInjection) tp++;
      else fn++;
    }

    for (const prompt of benignPrompts) {
      const start = performance.now();
      const res = detectInjection(prompt);
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

  // 4. Evaluate Claim Verification
  {
    const latencies: number[] = [];
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;

    for (const item of claims.supported) {
      const start = performance.now();
      const res = await groqService.verifyClaim(item.claim, [item.evidence]);
      latencies.push(performance.now() - start);

      if (res.status === 'supported') tp++;
      else fn++;
    }

    for (const item of claims.unsupported) {
      const start = performance.now();
      const res = await groqService.verifyClaim(item.claim, [item.evidence]);
      latencies.push(performance.now() - start);

      if (res.status === 'supported') fp++;
      else tn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
    const fnr = tp + fn > 0 ? fn / (tp + fn) : 0;

    results['claim_verification'] = {
      category: 'Claim Verification',
      totalSamples: claims.supported.length + claims.unsupported.length,
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
      approximateCostPerReqUsd: 0.0001, // Llama 3 on Groq
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
        Object.values(metrics).map((m) => ({
          Category: m.category,
          Samples: m.totalSamples,
          Precision: `${(m.precision * 100).toFixed(1)}%`,
          Recall: `${(m.recall * 100).toFixed(1)}%`,
          'FPR': `${(m.falsePositiveRate * 100).toFixed(1)}%`,
          'FNR': `${(m.falseNegativeRate * 100).toFixed(1)}%`,
          'P50 (ms)': `${m.medianLatencyMs} ms`,
          'P95 (ms)': `${m.p95LatencyMs} ms`,
          'Cost/Req': `$${m.approximateCostPerReqUsd.toFixed(6)}`,
        })),
      );
      console.log('✅ Evaluation complete! Saved report to evaluation_report.json\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Evaluation suite failed:', err);
      process.exit(1);
    });
}
