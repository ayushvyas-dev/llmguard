import { describe, it, expect } from 'vitest';
import { detectPii, redactPii } from '../../../src/modules/pii/pii.detector.js';

describe('PII Detector', () => {
  it('detects email addresses', () => {
    const input = 'Please contact support at security@llmguard.io for details.';
    const result = detectPii(input);

    expect(result.hasPii).toBe(true);
    const emailDetection = result.detections.find((d) => d.subtype === 'email');
    expect(emailDetection).toBeDefined();
    expect(emailDetection?.confidence).toBe(1.0);
  });

  it('detects Indian PAN numbers', () => {
    const input = 'My permanent account number is ABCDE1234F.';
    const result = detectPii(input);

    expect(result.hasPii).toBe(true);
    expect(result.detections.some((d) => d.subtype === 'pan')).toBe(true);
  });

  it('detects Aadhaar card pattern', () => {
    const input = 'Customer Aadhaar number is 9876 5432 1098 registered.';
    const result = detectPii(input);

    expect(result.hasPii).toBe(true);
    expect(result.detections.some((d) => d.subtype === 'aadhaar')).toBe(true);
  });

  it('detects IPv4 addresses', () => {
    const input = 'Server connecting to database at 192.168.1.105:5432.';
    const result = detectPii(input);

    expect(result.hasPii).toBe(true);
    expect(result.detections.some((d) => d.subtype === 'ip_address')).toBe(true);
  });

  it('detects API keys', () => {
    const input = 'Use secret token ghp_1234567890abcdef1234567890abcdef for auth.';
    const result = detectPii(input);

    expect(result.hasPii).toBe(true);
    expect(result.detections.some((d) => d.subtype === 'api_key')).toBe(true);
  });

  it('redacts detected PII properly', () => {
    const input = 'Contact me at john.doe@example.com immediately.';
    const result = detectPii(input);
    const redacted = redactPii(input, result.detections);

    expect(redacted).not.toContain('john.doe@example.com');
    expect(redacted).toContain('[EMAIL_REDACTED]');
  });
});
