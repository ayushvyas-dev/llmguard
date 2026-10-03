import prisma from '../../config/database.js';
import { validateToolCall } from './tool-validator.js';
import { auditService } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { config } from '../../config/env.js';
import { classifyToolCall } from '../../integrations/groq/tool-security-classifier.js';
import { sanitizeToolArguments } from './tool-argument-sanitizer.js';
import type {
  ToolValidationRequest,
  ToolValidationResult,
  ToolPolicyInput,
} from './tool.types.js';

export const toolService = {
  async validate(
    apiKeyId: string,
    requestId: string,
    request: ToolValidationRequest,
  ): Promise<ToolValidationResult> {
    const policy = await prisma.toolPolicy.findUnique({
      where: {
        apiKeyId_name: {
          apiKeyId,
          name: request.tool,
        },
      },
    });

    let evaluated = validateToolCall(request, policy);
    let semanticAnalysis: NonNullable<ToolValidationResult['semanticAnalysis']> = { performed: false, provider: 'groq', latencyMs: null, confidence: null };
    if (config.SEMANTIC_TOOL_ANALYSIS && (evaluated.riskScore >= 60 || (request.intendedOperation && evaluated.decision === 'review'))) {
      const start = performance.now();
      try {
        const classification = await classifyToolCall({ tool: request.tool, ...(request.intendedOperation ? { intendedOperation: request.intendedOperation } : {}), arguments: sanitizeToolArguments(request.arguments) });
        semanticAnalysis = { performed: true, provider: 'groq', latencyMs: classification.latencyMs, confidence: classification.result.confidence };
        if (classification.result.suspicious && classification.result.confidence >= 0.7) {
          const score = Math.max(evaluated.riskScore, Math.round(classification.result.confidence * 90));
          evaluated = { ...evaluated, allowed: false, requiresApproval: true, decision: 'review', riskScore: score, riskLevel: score >= 90 ? 'critical' : score >= 70 ? 'high' : 'medium', reason: `Semantic tool review identified ${classification.result.category}; explicit approval is required.` };
        }
      } catch {
        semanticAnalysis = { performed: true, provider: 'groq', latencyMs: Math.round(performance.now() - start), confidence: null, error: 'classification_unavailable_or_invalid' };
      }
    }

    // Create audit event
    const severity =
      evaluated.riskLevel === 'critical'
        ? 'critical'
        : evaluated.riskLevel === 'high'
          ? 'high'
          : evaluated.riskLevel === 'medium'
            ? 'medium'
            : 'low';

    void auditService.create({
      apiKeyId,
      requestId,
      type: 'tool_call',
      severity,
      decision: evaluated.decision,
      riskScore: evaluated.riskScore,
      metadata: {
        tool: request.tool,
        allowed: evaluated.allowed,
        requiresApproval: evaluated.requiresApproval,
        reason: evaluated.reason ?? null,
        semanticAnalysis,
      },
    });

    const result: ToolValidationResult = {
      requestId,
      allowed: evaluated.allowed,
      requiresApproval: evaluated.requiresApproval,
      decision: evaluated.decision,
      riskLevel: evaluated.riskLevel,
      riskScore: evaluated.riskScore,
      tool: request.tool,
      ...(evaluated.reason ? { reason: evaluated.reason } : {}),
      semanticAnalysis,
    };

    return result;
  },

  async createPolicy(apiKeyId: string, input: ToolPolicyInput) {
    const policy = await prisma.toolPolicy.upsert({
      where: {
        apiKeyId_name: {
          apiKeyId,
          name: input.name,
        },
      },
      update: {
        riskLevel: input.riskLevel,
        enabled: input.enabled,
        requiresApproval: input.requiresApproval,
      },
      create: {
        apiKeyId,
        name: input.name,
        riskLevel: input.riskLevel,
        enabled: input.enabled,
        requiresApproval: input.requiresApproval,
      },
    });

    return {
      id: policy.id,
      name: policy.name,
      riskLevel: policy.riskLevel,
      enabled: policy.enabled,
      requiresApproval: policy.requiresApproval,
      createdAt: policy.createdAt.toISOString(),
    };
  },

  async getPolicies(apiKeyId: string) {
    const policies = await prisma.toolPolicy.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      tools: policies.map((p) => ({
        id: p.id,
        name: p.name,
        riskLevel: p.riskLevel,
        enabled: p.enabled,
        requiresApproval: p.requiresApproval,
      })),
    };
  },

  async deletePolicy(apiKeyId: string, toolId: string) {
    const policy = await prisma.toolPolicy.findFirst({
      where: { id: toolId, apiKeyId },
    });

    if (!policy) {
      throw new NotFoundError(`Tool policy with id '${toolId}' not found.`);
    }

    await prisma.toolPolicy.delete({
      where: { id: toolId },
    });

    return {
      deleted: true,
      toolId,
    };
  },
};
