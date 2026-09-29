import {
  calculateRiskScore,
  scoreToDecision,
  scoreToRiskLevel,
  DEFAULT_THRESHOLDS,
} from './risk.rules.js';
import type { RiskInput, RiskResult, RiskThresholds } from './risk.types.js';

export const riskService = {
  calculate(
    input: RiskInput,
    thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
  ): RiskResult {
    const riskScore = calculateRiskScore(input.detections);
    const riskLevel = scoreToRiskLevel(riskScore);
    const decision = scoreToDecision(riskScore, thresholds);

    const reasons = input.detections
      .filter((d) => d.reason)
      .map((d) => d.reason!);

    return {
      riskScore,
      riskLevel,
      decision,
      reasons,
    };
  },
};
