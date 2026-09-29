import type { Request, Response, NextFunction } from 'express';
import { verificationService } from './verification.service.js';
import { documentSchema } from './verification.schema.js';
import type { AuthenticatedRequest } from '../api-key/api-key.types.js';
import { ValidationError } from '../../shared/errors/index.js';

export const documentController = {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = documentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(', '),
        );
      }

      const authReq = req as AuthenticatedRequest;
      const result = await verificationService.createDocument(
        authReq.apiKey.id,
        parsed.data,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const rawId = req.params['documentId'];
      const documentId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!documentId) {
        throw new ValidationError('Document ID is required');
      }

      const result = await verificationService.getDocument(
        authReq.apiKey.id,
        documentId,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const rawId = req.params['documentId'];
      const documentId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!documentId) {
        throw new ValidationError('Document ID is required');
      }

      const result = await verificationService.deleteDocument(
        authReq.apiKey.id,
        documentId,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
