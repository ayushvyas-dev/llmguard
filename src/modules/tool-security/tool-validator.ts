import {
  dangerousToolPatterns,
  dangerousArgumentPatterns,
} from './tool-policy.js';
import type { RiskLevel, ScanDecision } from '../../shared/types/index.js';
import type { ToolValidationRequest } from './tool.types.js';

export interface EvaluatedToolResult {
  allowed: boolean;
  requiresApproval: boolean;
  decision: ScanDecision;
  riskLevel: RiskLevel;
  riskScore: number;
  reason?: string;
}

export interface StoredPolicy {
  name: string;
  riskLevel: string;
  enabled: boolean;
  requiresApproval: boolean;
}

export function validateToolCall(
  request: ToolValidationRequest,
  registeredPolicy?: StoredPolicy | null,
): EvaluatedToolResult {
  // If explicitly registered policy exists
  if (registeredPolicy) {
    if (!registeredPolicy.enabled) {
      return {
        allowed: false,
        requiresApproval: false,
        decision: 'block',
        riskLevel: 'critical',
        riskScore: 100,
        reason: `Tool '${request.tool}' is disabled by policy.`,
      };
    }

    const riskLevel = registeredPolicy.riskLevel as RiskLevel;
    const requiresApproval = registeredPolicy.requiresApproval;
    const baseScore =
      riskLevel === 'critical'
        ? 95
        : riskLevel === 'high'
          ? 70
          : riskLevel === 'medium'
            ? 40
            : 5;

    // Check argument risks
    const argRisks = checkArgumentRisks(request.arguments);
    const totalScore = Math.min(100, baseScore + argRisks.additionalScore);
    const finalRiskLevel: RiskLevel =
      totalScore >= 80
        ? 'critical'
        : totalScore >= 60
          ? 'high'
          : totalScore >= 30
            ? 'medium'
            : 'low';

    const decision: ScanDecision =
      totalScore >= 70
        ? requiresApproval
          ? 'review'
          : 'block'
        : totalScore >= 30
          ? 'review'
          : 'allow';

    const reason =
      argRisks.reasons.length > 0
        ? argRisks.reasons.join(' ')
        : requiresApproval
          ? `Tool '${request.tool}' requires explicit approval.`
          : undefined;

    return {
      allowed: decision === 'allow' || (decision === 'review' && !requiresApproval),
      requiresApproval,
      decision,
      riskLevel: finalRiskLevel,
      riskScore: totalScore,
      ...(reason ? { reason } : {}),
    };
  }

  // Fallback to pattern matching
  for (const patternPolicy of dangerousToolPatterns) {
    if (patternPolicy.pattern.test(request.tool)) {
      const argRisks = checkArgumentRisks(request.arguments);
      const totalScore = Math.min(100, patternPolicy.riskScore + argRisks.additionalScore);
      const riskLevel = patternPolicy.riskLevel as RiskLevel;
      const requiresApproval = patternPolicy.requiresApproval;

      const decision: ScanDecision =
        totalScore >= 70
          ? requiresApproval
            ? 'review'
            : 'block'
          : totalScore >= 30
            ? 'review'
            : 'allow';

      const reasons = [patternPolicy.reason, ...argRisks.reasons].filter(Boolean);

      return {
        allowed: decision === 'allow',
        requiresApproval,
        decision,
        riskLevel,
        riskScore: totalScore,
        reason: reasons.join(' '),
      };
    }
  }

  // Only clearly read-only operations are implicitly allowed. Hosts should register policies for all other tools.
  if (!/(^|\.)(get|list|read|search|fetch|lookup|describe)([A-Z_.:-]|$)/i.test(request.tool)) {
    return { allowed: false, requiresApproval: true, decision: 'review', riskLevel: 'high', riskScore: 75, reason: `Tool '${request.tool}' has no registered policy and is not an implicitly read-only operation.` };
  }

  // Check argument risks even for unclassified tools
  const argRisks = checkArgumentRisks(request.arguments);
  if (argRisks.additionalScore > 0) {
    const riskScore = Math.min(100, argRisks.additionalScore + 10);
    const riskLevel: RiskLevel = riskScore >= 60 ? 'high' : 'medium';
    return {
      allowed: false,
      requiresApproval: true,
      decision: 'review',
      riskLevel,
      riskScore,
      reason: argRisks.reasons.join(' '),
    };
  }

  // Safe tool
  return {
    allowed: true,
    requiresApproval: false,
    decision: 'allow',
    riskLevel: 'low',
    riskScore: 5,
  };
}

function checkArgumentRisks(args: Record<string, unknown>): {
  additionalScore: number;
  reasons: string[];
} {
  let additionalScore = 0;
  const reasons: string[] = [];

  if (!args || typeof args !== 'object') {
    return { additionalScore: 0, reasons: [] };
  }

  for (const [key, value] of Object.entries(args)) {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    for (const rule of dangerousArgumentPatterns) {
      if (rule.key.test(key) && rule.value.test(stringValue)) {
        additionalScore += rule.additionalRisk;
        reasons.push(rule.reason);
      }
    }
  }

  return { additionalScore, reasons };
}
