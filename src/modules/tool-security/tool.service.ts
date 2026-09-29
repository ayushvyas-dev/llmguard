import prisma from '../../config/database.js';
import { validateToolCall } from './tool-validator.js';
import { auditService } from '../audit/audit.service.js';
import { NotFoundError } from '../../shared/errors/index.js';
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

    const evaluated = validateToolCall(request, policy);

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
