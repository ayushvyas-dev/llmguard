import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectInjection } from '../../src/modules/prompt-injection/injection.detector.js';
import { detectPii } from '../../src/modules/pii/pii.detector.js';
import { normalizeForSecurity } from '../../src/modules/normalization/normalize.js';
import { validateToolCall } from '../../src/modules/tool-security/tool-validator.js';
import { classifySecurity } from '../../src/integrations/groq/security-classifier.js';
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
  approximateCostPerReqUsd: number | null;
}

export interface ClaimVerificationMetrics {
  category: string;
  status?: 'not_run';
  reason?: string;
  totalSamples: number;
  accuracy: number | 'N/A';
  precision: number | 'N/A';
  recall: number | 'N/A';
  f1: number | 'N/A';
  macroF1: number | 'N/A';
  confusionMatrix: Record<string, Record<string, number>>;
  perClass: Record<string, { precision: number | 'N/A'; recall: number | 'N/A'; f1: number | 'N/A'; support: number }>;
  evidenceFoundRate: number | 'N/A';
  evidenceRetrievalPrecision: number | 'N/A';
  averageSimilarity: number | 'N/A';
  medianRetrievalLatencyMs: number | 'N/A';
  p95RetrievalLatencyMs: number | 'N/A';
  claimExtractionLatencyMs: number | 'N/A';
  verificationLatencyMs: number | 'N/A';
  totalVerificationLatencyMs: number | 'N/A';
  p95VerificationLatencyMs: number | 'N/A';
  embeddingProviderCalls: number;
  note: string;
}

type ClaimLabel = 'supported' | 'unsupported' | 'uncertain';
const CLAIM_LABELS: ClaimLabel[] = ['supported', 'unsupported', 'uncertain'];

function ratio(numerator: number, denominator: number): number | 'N/A' {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 'N/A';
}

export async function runClaimVerificationEvaluation(): Promise<ClaimVerificationMetrics> {
  const fixture: Record<ClaimLabel, Array<{ claim: string; evidence: string }>> = JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'claims.json'), 'utf8'),
  );
  const samples = CLAIM_LABELS.flatMap((expected) => (fixture[expected] ?? []).map((item) => ({ ...item, expected })));
  const confusionMatrix = Object.fromEntries(CLAIM_LABELS.map((actual) => [
    actual,
    Object.fromEntries(CLAIM_LABELS.map((expected) => [expected, 0])),
  ])) as Record<ClaimLabel, Record<ClaimLabel, number>>;
  const latencies: number[] = [];
  let correct = 0;

  for (const sample of samples) {
    // The fixture's passage is supplied directly to the verifier. Retrieval is
    // intentionally not simulated; retrieval metrics remain N/A in this run.
    const start = performance.now();
    const result = await groqService.verifyClaim(sample.claim, sample.evidence.trim() ? [sample.evidence] : [], {
      useProvider: process.env['EVAL_CLAIMS_LIVE'] === '1',
    });
    latencies.push(performance.now() - start);
    confusionMatrix[sample.expected][result.status]++;
    if (sample.expected === result.status) correct++;
  }

  const perClass = Object.fromEntries(CLAIM_LABELS.map((label) => {
    const tp = confusionMatrix[label][label];
    const predicted = CLAIM_LABELS.reduce((sum, actual) => sum + confusionMatrix[actual][label], 0);
    const support = CLAIM_LABELS.reduce((sum, expected) => sum + confusionMatrix[label][expected], 0);
    const precision = predicted ? Number((tp / predicted).toFixed(4)) : (support ? 0 : 'N/A');
    const recall = ratio(tp, support);
    const f1 = typeof precision === 'number' && typeof recall === 'number' && precision + recall > 0
      ? Number((2 * precision * recall / (precision + recall)).toFixed(4))
      : (support ? 0 : 'N/A');
    return [label, { precision, recall, f1, support }];
  })) as ClaimVerificationMetrics['perClass'];
  const representedF1 = Object.values(perClass).filter((entry) => entry.support > 0 && typeof entry.f1 === 'number').map((entry) => entry.f1 as number);
  const macroPrecision = Object.values(perClass).filter((entry) => entry.support > 0 && typeof entry.precision === 'number').map((entry) => entry.precision as number);
  const macroRecall = Object.values(perClass).filter((entry) => entry.support > 0 && typeof entry.recall === 'number').map((entry) => entry.recall as number);
  const mean = (values: number[]) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 'N/A';

  return {
    category: 'Claim Verification',
    totalSamples: samples.length,
    accuracy: ratio(correct, samples.length),
    precision: mean(macroPrecision), recall: mean(macroRecall), f1: mean(representedF1),
    macroF1: mean(representedF1),
    confusionMatrix,
    perClass,
    evidenceFoundRate: 'N/A',
    evidenceRetrievalPrecision: 'N/A', averageSimilarity: 'N/A',
    medianRetrievalLatencyMs: 'N/A', p95RetrievalLatencyMs: 'N/A',
    claimExtractionLatencyMs: 'N/A',
    verificationLatencyMs: calculatePercentile(latencies, 50),
    totalVerificationLatencyMs: 'N/A',
    p95VerificationLatencyMs: calculatePercentile(latencies, 95),
    embeddingProviderCalls: 0,
    note: configNote(),
  };
}

function configNote(): string {
  return process.env['EVAL_CLAIMS_LIVE'] === '1'
    ? 'Live Groq verifier used; fixture evidence was supplied directly. Database retrieval and extraction were not run.'
    : 'Measured the local fallback verifier (set EVAL_CLAIMS_LIVE=1 for provider calls). Fixture evidence was supplied directly; retrieval and extraction were not run.';
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

  (results as Record<string, unknown>)['claim_verification'] = await runClaimVerificationEvaluation();

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
      console.log('\nClaim verification benchmark:');
      console.log(JSON.stringify((metrics as Record<string, unknown>)['claim_verification'], null, 2));
      console.log('✅ Evaluation complete! Saved report to evaluation_report.json\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Evaluation suite failed:', err);
      process.exit(1);
    });
}
