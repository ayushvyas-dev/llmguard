import { describe, it, expect } from 'vitest';
import { validateToolCall } from '../../../src/modules/tool-security/tool-validator.js';

describe('Tool Security Validator', () => {
  it('allows safe read operations', () => {
    const result = validateToolCall({
      tool: 'github.getRepository',
      arguments: { repository: 'company/project' },
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.decision).toBe('allow');
    expect(result.riskLevel).toBe('low');
  });

  it('blocks or flags destructive operations for human approval', () => {
    const result = validateToolCall({
      tool: 'github.deleteRepository',
      arguments: { repository: 'company/project' },
    });

    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.decision).toBe('review');
    expect(result.riskLevel).toBe('critical');
    expect(result.riskScore).toBeGreaterThanOrEqual(90);
  });

  it('detects dangerous argument keys like sql queries or shell commands', () => {
    const result = validateToolCall({
      tool: 'custom.runQuery',
      arguments: { sql: 'DROP TABLE users CASCADE;' },
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(25);
  });

  it('enforces registered policy when tool is disabled', () => {
    const policy = {
      name: 'stripe.createCharge',
      riskLevel: 'critical',
      enabled: false,
      requiresApproval: true,
    };

    const result = validateToolCall(
      {
        tool: 'stripe.createCharge',
        arguments: { amount: 5000 },
      },
      policy,
    );

    expect(result.allowed).toBe(false);
    expect(result.decision).toBe('block');
    expect(result.riskScore).toBe(100);
  });
});
