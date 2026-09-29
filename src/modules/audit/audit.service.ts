import prisma from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import logger from '../../config/logger.js';
import type { Detection, ScanDecision } from '../../shared/types/index.js';

export interface CreateAuditEventInput {
  apiKeyId: string;
  requestId: string;
  scanId?: string;
  type: string;
  severity: string;
  decision: string;
  riskScore?: number;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryParams {
  apiKeyId: string;
  severity?: string | undefined;
  decision?: string | undefined;
  type?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export const auditService = {
  async create(input: CreateAuditEventInput): Promise<void> {
    try {
      await prisma.auditEvent.create({
        data: {
          apiKeyId: input.apiKeyId,
          requestId: input.requestId,
          scanId: input.scanId ?? null,
          type: input.type,
          severity: input.severity,
          decision: input.decision,
          riskScore: input.riskScore ?? null,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    } catch (error) {
      // Audit logging should not break the request flow
      logger.error({ err: error }, 'Failed to create audit event');
    }
  },

  async createFromScan(params: {
    apiKeyId: string;
    requestId: string;
    scanId: string;
    decision: ScanDecision;
    riskScore: number;
    detections: Detection[];
  }): Promise<void> {
    const severity = params.decision === 'block' ? 'high' : params.decision === 'review' ? 'medium' : 'low';
    const type = params.detections.length > 0 ? params.detections[0]!.type : 'scan';

    await this.create({
      apiKeyId: params.apiKeyId,
      requestId: params.requestId,
      scanId: params.scanId,
      type,
      severity,
      decision: params.decision,
      riskScore: params.riskScore,
      metadata: {
        detectionCount: params.detections.length,
        detectionTypes: [...new Set(params.detections.map((d) => d.type))],
      },
    });
  },

  async query(params: AuditQueryParams) {
    const where: Record<string, unknown> = {
      apiKeyId: params.apiKeyId,
    };

    if (params.severity) where['severity'] = params.severity;
    if (params.decision) where['decision'] = params.decision;
    if (params.type) where['type'] = params.type;
    if (params.cursor) {
      where['id'] = { lt: params.cursor };
    }

    const limit = Math.min(params.limit ?? 50, 100);

    const events = await prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = events.length > limit;
    const results = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? results[results.length - 1]?.id : null;

    return {
      events: results.map((e) => ({
        id: e.id,
        requestId: e.requestId,
        type: e.type,
        severity: e.severity,
        decision: e.decision,
        riskScore: e.riskScore,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: nextCursor ?? null,
    };
  },
};
