import type { Request, Response, NextFunction } from 'express';
import { verificationService } from './verification.service.js';
import { verifySchema } from './verification.schema.js';
import type { AuthenticatedRequest } from '../api-key/api-key.types.js';
import { ValidationError } from '../../shared/errors/index.js';

export const verificationController = {
  async createJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(', '),
        );
      }

      const authReq = req as AuthenticatedRequest;
      const result = await verificationService.createJob(
        authReq.apiKey.id,
        parsed.data,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async getJob(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const rawJobId = req.params['jobId'];
      const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
      if (!jobId) {
        throw new ValidationError('Job ID is required');
      }

      const result = await verificationService.getJob(authReq.apiKey.id, jobId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
