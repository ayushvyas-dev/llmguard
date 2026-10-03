import { config } from '../../config/env.js';

export type SecurityMode = 'balanced' | 'strict' | 'permissive';
export type ProviderFailureMode = 'fail_open' | 'fail_closed' | 'review_on_failure';
export interface SemanticRoutingPolicy {
  mode: 'always' | 'intelligent' | 'high_risk';
  samplingRate: number;
  analyzeUntrustedContent: boolean;
  analyzeSensitiveOperations: boolean;
  analyzeAmbiguousInputs: boolean;
  sensitivityThreshold: 'sensitive';
}
export const securityPolicies = {
  balanced: { allow: 24, review: 64, routingMode: 'intelligent' as const },
  strict: { allow: 14, review: 44, routingMode: 'always' as const },
  permissive: { allow: 34, review: 74, routingMode: 'high_risk' as const },
};
export const securityRiskUplift = {
  untrustedInstruction: 12,
  pii: 15,
  operation: { low: 0, medium: 5, high: 12, critical: 18 },
  sensitivity: { public: 0, internal: 3, sensitive: 8, critical: 12 },
} as const;
export function getSecurityPolicy(requested?: SecurityMode) {
  const mode = requested ?? config.SECURITY_MODE;
  const base = securityPolicies[mode];
  const routing: SemanticRoutingPolicy = {
    mode: base.routingMode,
    samplingRate: mode === 'strict' ? 1 : config.SEMANTIC_SAMPLING_RATE,
    analyzeUntrustedContent: config.SEMANTIC_ANALYZE_UNTRUSTED,
    analyzeSensitiveOperations: config.SEMANTIC_ANALYZE_SENSITIVE,
    analyzeAmbiguousInputs: config.SEMANTIC_ANALYZE_AMBIGUOUS,
    sensitivityThreshold: 'sensitive',
  };
  return { mode, allow: base.allow, review: base.review, routing, riskUplift: securityRiskUplift, failureMode: config.CLASSIFIER_FAILURE_MODE };
}

/** Stable [0,1) bucket so the same request ID gets the same sampling decision. */
export function requestSamplingBucket(requestId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < requestId.length; i++) hash = Math.imul(hash ^ requestId.charCodeAt(i), 16777619);
  return (hash >>> 0) / 0x1_0000_0000;
}
