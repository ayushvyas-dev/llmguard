import { describe, expect, it } from 'vitest';
import { toolSecurityResultSchema } from '../../../src/integrations/groq/tool-security-classifier.js';
import { sanitizeToolArguments } from '../../../src/modules/tool-security/tool-argument-sanitizer.js';

describe('semantic tool security contract', () => {
  it('validates structured tool-review results', () => {
    expect(toolSecurityResultSchema.safeParse({ suspicious: true, confidence: 0.9, category: 'data_exfiltration', reason: 'Data is sent to an unrelated destination.' }).success).toBe(true);
    expect(toolSecurityResultSchema.safeParse({ suspicious: true, confidence: 9, category: 'unknown', reason: 'bad' }).success).toBe(false);
  });

  it('redacts credential and PII values recursively before optional provider analysis', () => {
    const safe = sanitizeToolArguments({ token: 'gsk_abcdefghijklmnop1234', nested: { recipient: 'person@example.com', cmd: 'echo safe' } }) as Record<string, unknown>;
    expect(safe['token']).toBe('[REDACTED_SECRET]');
    expect((safe['nested'] as Record<string, unknown>)['recipient']).toBe('[REDACTED_PII]');
    expect((safe['nested'] as Record<string, unknown>)['cmd']).toBe('echo safe');
  });
});
