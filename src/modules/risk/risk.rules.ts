import type { Detection, RiskLevel, ScanDecision } from '../../shared/types/index.js';
import type { RiskThresholds } from './risk.types.js';

/**
 * Default risk thresholds per the requirements:
 *   0-29:   ALLOW
 *   30-69:  REVIEW
 *   70-100: BLOCK
 */
export const DEFAULT_THRESHOLDS: RiskThresholds = {
  allow: 29,
  review: 69,
};

/**
 * Weights for different detection types.
 * Higher weight = more influence on the final risk score.
 */
export const DETECTION_WEIGHTS: Record<string, number> = {
  prompt_injection: 1.0,
  pii: 0.6,
  tool_risk: 0.9,
};

/**
 * Map a risk score (0-100) to a risk level.
 */
export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * Map a risk score (0-100) to a decision using the provided thresholds.
 */
export function scoreToDecision(
  score: number,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
): ScanDecision {
  if (score <= thresholds.allow) return 'allow';
  if (score <= thresholds.review) return 'review';
  return 'block';
}

/**
 * Calculate a composite risk score from a list of detections.
 * Uses the maximum confidence weighted by detection type.
 */
export function calculateRiskScore(detections: Detection[]): number {
  if (detections.length === 0) return 0;

  let maxWeightedScore = 0;

  for (const detection of detections) {
    const weight = DETECTION_WEIGHTS[detection.type] ?? 0.5;
    const weightedScore = detection.confidence * weight * 100;
    if (weightedScore > maxWeightedScore) {
      maxWeightedScore = weightedScore;
    }
  }

  return Math.min(100, Math.round(maxWeightedScore));
}
