import prisma from '../../config/database.js';
import { promptInjectionService } from '../prompt-injection/injection.service.js';
import { piiService } from '../pii/pii.service.js';
import { riskService } from '../risk/risk.service.js';
import { auditService } from '../audit/audit.service.js';
import type { Detection, ScanResult } from '../../shared/types/index.js';
import type { InternalScanRequest } from './scan.types.js';

export const scanService = {
  async scan(request: InternalScanRequest): Promise<ScanResult> {
    const detections: Detection[] = [];

    // Run prompt injection detection
    const injectionResult = promptInjectionService.detect(request.input);
    detections.push(...injectionResult.detections);

    // Run PII detection
    const piiResult = piiService.detect(request.input);
    detections.push(...piiResult.detections);

    // Calculate risk
    const riskResult = riskService.calculate({ detections });

    // Persist scan to database
    const scan = await prisma.scan.create({
      data: {
        requestId: request.requestId,
        apiKeyId: request.apiKeyId,
        type: request.type,
        input: request.input,
        decision: riskResult.decision,
        riskScore: riskResult.riskScore,
        riskLevel: riskResult.riskLevel,
        status: 'COMPLETED',
        detections: {
          create: detections.map((d) => ({
            type: d.type,
            subtype: d.subtype ?? null,
            confidence: d.confidence,
            reason: d.reason ?? null,
            start: d.start ?? null,
            end: d.end ?? null,
          })),
        },
      },
    });

    // Create audit event (non-blocking)
    void auditService.createFromScan({
      apiKeyId: request.apiKeyId,
      requestId: request.requestId,
      scanId: scan.id,
      decision: riskResult.decision,
      riskScore: riskResult.riskScore,
      detections,
    });

    return {
      requestId: request.requestId,
      decision: riskResult.decision,
      riskLevel: riskResult.riskLevel,
      riskScore: riskResult.riskScore,
      detections,
      createdAt: scan.createdAt,
    };
  },
};
