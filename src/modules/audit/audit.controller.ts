import type { Request, Response, NextFunction } from 'express';
import { auditService } from './audit.service.js';
import type { AuthenticatedRequest } from '../api-key/api-key.types.js';

export const auditController = {
  async getEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const { severity, decision, type, limit, cursor } = req.query;

      const result = await auditService.query({
        apiKeyId: authReq.apiKey.id,
        severity: severity as string | undefined,
        decision: decision as string | undefined,
        type: type as string | undefined,
        limit: limit ? Number(limit) : undefined,
        cursor: cursor as string | undefined,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
