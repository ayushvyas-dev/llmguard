import { config } from '../../config/env.js';

export type SecurityMode = 'balanced' | 'strict' | 'permissive';
export type ProviderFailureMode = 'fail_open' | 'fail_closed' | 'review_on_failure';
export const securityPolicies = {
  balanced: { allow: 24, review: 64, semantic: 'suspicious' as const },
  strict: { allow: 14, review: 44, semantic: 'always' as const },
  permissive: { allow: 34, review: 74, semantic: 'high_risk' as const },
};
export function getSecurityPolicy(requested?: SecurityMode) {
  const mode = requested ?? config.SECURITY_MODE;
  return { mode, ...securityPolicies[mode], failureMode: config.CLASSIFIER_FAILURE_MODE };
}
