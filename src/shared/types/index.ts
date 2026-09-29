// Shared types used across modules

export type ScanInputType = 'prompt' | 'text' | 'response';

export type ScanDecision = 'allow' | 'review' | 'block';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Detection {
  type: string;
  subtype?: string;
  confidence: number;
  reason?: string;
  start?: number;
  end?: number;
}

export interface ScanResult {
  requestId: string;
  decision: ScanDecision;
  riskLevel: RiskLevel;
  riskScore: number;
  detections: Detection[];
  createdAt: Date;
}
