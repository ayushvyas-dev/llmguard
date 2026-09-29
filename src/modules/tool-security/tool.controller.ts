import type { Request, Response, NextFunction } from 'express';
import { toolService } from './tool.service.js';
import { toolValidationSchema, toolPolicySchema } from './tool.schema.js';
import type { AuthenticatedRequest } from '../api-key/api-key.types.js';
import { ValidationError } from '../../shared/errors/index.js';

export const toolController = {
  async validate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = toolValidationSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(', '),
        );
      }

      const authReq = req as AuthenticatedRequest;
      const result = await toolService.validate(
        authReq.apiKey.id,
        req.id,
        parsed.data,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = toolPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join(', '),
        );
      }

      const authReq = req as AuthenticatedRequest;
      const result = await toolService.createPolicy(
        authReq.apiKey.id,
        parsed.data,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const result = await toolService.getPolicies(authReq.apiKey.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authReq = req as AuthenticatedRequest;
      const rawId = req.params['toolId'];
      const toolId = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!toolId) {
        throw new ValidationError('Tool ID is required');
      }

      const result = await toolService.deletePolicy(authReq.apiKey.id, toolId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
