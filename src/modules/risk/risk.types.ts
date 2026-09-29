import type { Detection, ScanDecision, RiskLevel } from '../../shared/types/index.js';

export interface RiskInput {
  detections: Detection[];
}

export interface RiskResult {
  riskScore: number;
  riskLevel: RiskLevel;
  decision: ScanDecision;
  reasons: string[];
}

export interface RiskThresholds {
  allow: number;
  review: number;
  // Anything above review threshold is "block"
}
