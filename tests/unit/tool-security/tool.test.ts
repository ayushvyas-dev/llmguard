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

  it('reviews unknown tools by default', () => {
    const result = validateToolCall({ tool: 'custom.performAction', arguments: {} });
    expect(result.decision).toBe('review');
    expect(result.allowed).toBe(false);
  });

  it('requires approval for sensitive named tools and mismatched intent', () => {
    const sensitive = validateToolCall({ tool: 'transfer_money', arguments: { amount: 50 }, intendedOperation: 'summarize a news article' });
    expect(sensitive.requiresApproval).toBe(true);
    expect(sensitive.decision).toBe('review');
    expect(sensitive.allowed).toBe(false);
  });

  it('flags tool actions inconsistent with the supplied operation', () => {
    const result = validateToolCall({ tool: 'mail.sendEmail', arguments: { to: 'team@example.com' }, intendedOperation: 'summarize this page' });
    expect(result.decision).toBe('review');
    expect(result.reason).toContain('intended operation');
    const aligned = validateToolCall({ tool: 'mail.sendEmail', arguments: { to: 'team@example.com' }, intendedOperation: 'email the approved summary' });
    expect(aligned.reason).not.toContain('intended operation');
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

  it('detects dangerous nested arguments', () => {
    const result = validateToolCall({ tool: 'custom.process', arguments: { options: { nested: { shell: 'rm -rf /' } } } });
    expect(result.decision).toBe('review');
    expect(result.requiresApproval).toBe(true);
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
