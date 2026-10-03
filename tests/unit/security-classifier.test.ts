import { describe, expect, it } from 'vitest';
import { securityClassificationSchema } from '../../src/integrations/groq/security-classifier.js';
import { getSecurityPolicy, requestSamplingBucket } from '../../src/modules/security-policy/security-policy.js';

describe('semantic security contract', () => {
  it('accepts the explicit attack taxonomy and rejects malformed provider output', () => {
    const valid = { isInjection: true, confidence: 0.94, category: 'indirect_prompt_injection', attackType: 'indirect', severity: 'high', reason: 'A webpage asks the model to reveal hidden instructions.', signals: ['secret_extraction'] };
    expect(securityClassificationSchema.safeParse(valid).success).toBe(true);
    expect(securityClassificationSchema.safeParse({ ...valid, confidence: 4 }).success).toBe(false);
    expect(securityClassificationSchema.safeParse({ ...valid, category: 'whatever' }).success).toBe(false);
  });
  it('uses centralized distinct thresholds for policy modes', () => {
    expect(getSecurityPolicy('strict').routing.mode).toBe('always');
    expect(getSecurityPolicy('balanced').routing.mode).toBe('intelligent');
    expect(getSecurityPolicy('permissive').routing.mode).toBe('high_risk');
  });
  it('uses a stable sampling bucket for the same request id', () => {
    expect(requestSamplingBucket('req-stable')).toBe(requestSamplingBucket('req-stable'));
    expect(requestSamplingBucket('req-other')).not.toBe(requestSamplingBucket('req-stable'));
  });
});
