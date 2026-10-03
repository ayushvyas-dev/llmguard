import type { Request, Response, NextFunction } from 'express';
import { scanService } from './scan.service.js';
import { scanSchema, contentScanSchema } from './scan.schema.js';
import type { AuthenticatedRequest } from '../api-key/api-key.types.js';
import { ValidationError } from '../../shared/errors/index.js';

export const scanController = {
  async scan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = scanSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(', '),
        );
      }

      const authReq = req as AuthenticatedRequest;

      const result = await scanService.scan({
        type: parsed.data.type,
        input: parsed.data.input,
        requestId: req.id,
        apiKeyId: authReq.apiKey.id,
        ...(parsed.data.context ? { context: parsed.data.context } : {}),
        ...(parsed.data.policy ? { policy: parsed.data.policy } : {}),
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
  async scanContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = contentScanSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      const authReq = req as AuthenticatedRequest;
      const result = await scanService.scan({
        type: 'text', input: parsed.data.content, inputSource: parsed.data.source, inputTrust: parsed.data.trust, intendedOperation: parsed.data.intendedOperation,
        requestId: req.id, apiKeyId: authReq.apiKey.id,
        ...(parsed.data.policy ? { policy: parsed.data.policy } : {}),
      });
      res.status(200).json(result);
    } catch (error) { next(error); }
  },
};
