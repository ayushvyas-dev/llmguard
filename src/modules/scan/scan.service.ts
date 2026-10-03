import prisma from '../../config/database.js';
import { promptInjectionService } from '../prompt-injection/injection.service.js';
import { piiService } from '../pii/pii.service.js';
import { auditService } from '../audit/audit.service.js';
import { normalizeForSecurity } from '../normalization/normalize.js';
import { getSecurityPolicy } from '../security-policy/security-policy.js';
import { classifySecurity } from '../../integrations/groq/security-classifier.js';
import type { Detection, ScanDecision, RiskLevel } from '../../shared/types/index.js';
import type { InternalScanRequest } from './scan.types.js';

export const scanService = {
  async scan(request: InternalScanRequest) {
    const policy = getSecurityPolicy(request.policy);
    const detections: Detection[] = [];
    const segments = [
      { source: request.inputSource ?? 'user', trust: request.inputTrust ?? ('trusted' as const), content: request.input },
      ...(request.context ?? []),
    ];
    const normalized = segments.map((segment) => ({ ...segment, ...normalizeForSecurity(segment.content) }));
    let ruleConfidence = 0;
    let untrustedInstructionSignal = false;
    for (const segment of normalized) {
      const injection = promptInjectionService.detect(segment.text);
      const pii = piiService.detect(segment.text);
      if (segment.trust === 'untrusted' && injection.isInjection) {
        untrustedInstructionSignal = true;
        for (const detection of injection.detections) detections.push({ ...detection, subtype: `indirect_${detection.subtype ?? 'prompt_injection'}`, reason: `Untrusted ${segment.source} content contains an instruction-like attack signal.` });
      } else detections.push(...injection.detections);
      detections.push(...pii.detections);
      ruleConfidence = Math.max(ruleConfidence, injection.highestConfidence);
      if (segment.signals.length) detections.push({ type: 'obfuscation', subtype: segment.signals.join(','), confidence: 0.55, reason: 'Input uses transformations that can obscure security-relevant text.' });
      if (segment.trust === 'untrusted' && /\b(ignore|disregard|override|reveal|send|call|change your task|system prompt|hidden instruction)\b/i.test(segment.text)) untrustedInstructionSignal = true;
    }

    const suspicious = detections.some((d) => d.type === 'prompt_injection' || d.type === 'obfuscation') || untrustedInstructionSignal;
    const shouldClassify = policy.semantic === 'always' || (policy.semantic === 'suspicious' && suspicious) || (policy.semantic === 'high_risk' && ruleConfidence >= 0.9);
    let semantic: { performed: boolean; provider: string; latencyMs: number | null; confidence: number | null; error?: string } = { performed: false, provider: 'groq', latencyMs: null, confidence: null };
    let classifierFailed = false;
    let semanticRisk = 0;
    let semanticInjection = false;
    if (shouldClassify) {
      const classifierStart = performance.now();
      try {
        const [primary, ...contextSegments] = normalized;
        const result = await classifySecurity({ content: primary?.text ?? request.input, source: primary?.source ?? 'user', trust: primary?.trust ?? 'trusted', intendedOperation: request.intendedOperation ?? request.type, context: contextSegments.map(({ source, trust, text }) => ({ source, trust, content: text })) });
        semantic = { performed: true, provider: 'groq', latencyMs: result.latencyMs, confidence: result.classification.confidence };
        const c = result.classification;
        semanticInjection = c.isInjection;
        semanticRisk = c.isInjection ? Math.round(c.confidence * (c.severity === 'critical' ? 100 : c.severity === 'high' ? 90 : c.severity === 'medium' ? 68 : 42)) : 0;
        if (c.isInjection) detections.push({ type: 'prompt_injection_semantic', subtype: c.category, confidence: c.confidence, reason: `Semantic classifier identified ${c.attackType} ${c.category} evidence (${c.severity}).` });
        if (c.category === 'ambiguous') semanticRisk = Math.max(semanticRisk, Math.round(c.confidence * 45));
      } catch (error) {
        classifierFailed = true;
        semantic = { performed: true, provider: 'groq', latencyMs: Math.round(performance.now() - classifierStart), confidence: null, error: 'classification_unavailable_or_invalid' };
        detections.push({ type: 'semantic_analysis', subtype: 'unavailable', confidence: 0, reason: 'Semantic analysis could not be completed; policy failure handling was applied.' });
      }
    }
    // Max evidence avoids double-counting correlated rules; independent PII and untrusted-source evidence add bounded risk.
    const piiRisk = detections.some((d) => d.type === 'pii') ? 15 : 0;
    const providerFailureRisk = classifierFailed && shouldClassify
      ? policy.failureMode === 'fail_closed' ? 100 : policy.failureMode === 'review_on_failure' ? policy.allow + 1 : 0
      : 0;
    const riskScore = Math.max(0, Math.min(100, Math.round(Math.max(ruleConfidence * 86, semanticRisk, providerFailureRisk) + (untrustedInstructionSignal ? 12 : 0) + piiRisk)));
    let decision: ScanDecision = riskScore <= policy.allow ? 'allow' : riskScore <= policy.review ? 'review' : 'block';
    if (classifierFailed && shouldClassify) {
      if (policy.failureMode === 'fail_closed') decision = 'block';
      else if (policy.failureMode === 'review_on_failure' && decision === 'allow') decision = 'review';
    }
    const riskLevel: RiskLevel = riskScore >= 90 ? 'critical' : riskScore >= 70 ? 'high' : riskScore >= 30 ? 'medium' : 'low';
    // Scan.input is retained for compatibility but stores a redacted representation. Never persist the classifier payload.
    const safeInput = `[INPUT_NOT_RETAINED length=${request.input.length}]`;
    const scan = await prisma.scan.create({
      data: {
        requestId: request.requestId, apiKeyId: request.apiKeyId, type: request.type,
        input: safeInput, decision, riskScore, riskLevel, status: 'COMPLETED',
        detections: { create: detections.map((d) => ({ type: d.type, subtype: d.subtype ?? null, confidence: d.confidence, reason: d.reason ?? null, start: null, end: null })) },
      },
    });
    void auditService.createFromScan({ apiKeyId: request.apiKeyId, requestId: request.requestId, scanId: scan.id, decision, riskScore, detections });
    void auditService.create({ apiKeyId: request.apiKeyId, requestId: request.requestId, scanId: scan.id, type: 'security_decision', severity: riskLevel, decision, riskScore, metadata: { policy: policy.mode, semantic, trustedContextCount: segments.filter((s) => s.trust === 'trusted').length, untrustedContextCount: segments.filter((s) => s.trust === 'untrusted').length, classifierFailed, semanticInjection } });
    return {
      requestId: request.requestId, decision, riskLevel, riskScore, detections, createdAt: scan.createdAt,
      reasons: [...new Set(detections.flatMap((d) => d.reason ? [d.reason] : []))],
      security: { policy: policy.mode, semanticAnalysis: semantic, classifierConfidence: semantic.confidence, riskComponents: { deterministic: Math.round(ruleConfidence * 86), semantic: semanticRisk, untrustedContent: untrustedInstructionSignal ? 12 : 0, pii: piiRisk, providerFailure: providerFailureRisk }, storedInputRedacted: true },
    };
  },
};
