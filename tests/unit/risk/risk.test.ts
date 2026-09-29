import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  scoreToDecision,
  scoreToRiskLevel,
} from '../../../src/modules/risk/risk.rules.js';
import { riskService } from '../../../src/modules/risk/risk.service.js';

describe('Risk Engine', () => {
  it('returns 0 risk and ALLOW for empty detections', () => {
    const result = riskService.calculate({ detections: [] });

    expect(result.riskScore).toBe(0);
    expect(result.decision).toBe('allow');
    expect(result.riskLevel).toBe('low');
  });

  it('maps scores into correct decisions based on thresholds (0-29 allow, 30-69 review, 70-100 block)', () => {
    expect(scoreToDecision(15)).toBe('allow');
    expect(scoreToDecision(29)).toBe('allow');
    expect(scoreToDecision(30)).toBe('review');
    expect(scoreToDecision(60)).toBe('review');
    expect(scoreToDecision(69)).toBe('review');
    expect(scoreToDecision(70)).toBe('block');
    expect(scoreToDecision(95)).toBe('block');
  });

  it('maps scores to risk levels properly', () => {
    expect(scoreToRiskLevel(10)).toBe('low');
    expect(scoreToRiskLevel(45)).toBe('medium');
    expect(scoreToRiskLevel(75)).toBe('high');
    expect(scoreToRiskLevel(95)).toBe('critical');
  });

  it('calculates weighted composite score for high-severity prompt injection', () => {
    const score = calculateRiskScore([
      {
        type: 'prompt_injection',
        subtype: 'instruction_override',
        confidence: 0.95,
      },
    ]);

    expect(score).toBe(95);
    expect(scoreToDecision(score)).toBe('block');
  });
});
