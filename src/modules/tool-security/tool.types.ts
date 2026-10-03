import type { RiskLevel, ScanDecision } from '../../shared/types/index.js';

export interface ToolValidationRequest {
  tool: string;
  arguments: Record<string, unknown>;
  intendedOperation?: string;
}

export interface ToolValidationResult {
  requestId: string;
  allowed: boolean;
  requiresApproval: boolean;
  decision: ScanDecision;
  riskLevel: RiskLevel;
  riskScore: number;
  tool: string;
  reason?: string;
  semanticAnalysis?: { performed: boolean; provider: 'groq'; latencyMs: number | null; confidence: number | null; error?: string };
}

export interface ToolPolicyInput {
  name: string;
  riskLevel: string;
  enabled: boolean;
  requiresApproval: boolean;
}
