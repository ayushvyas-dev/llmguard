import type { NextFunction, Request, Response } from 'express';
import { apiKeyService } from '../modules/api-key/api-key.service.js';
import type { AuthenticatedRequest } from '../modules/api-key/api-key.types.js';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key is required.',
          requestId: req.id,
        },
      });
      return;
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authorization header must use Bearer scheme.',
          requestId: req.id,
        },
      });
      return;
    }

    const apiKey = await apiKeyService.authenticate(token);

    if (!apiKey) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key.',
          requestId: req.id,
        },
      });
      return;
    }

    (req as AuthenticatedRequest).apiKey = apiKey;
    next();
  } catch (error) {
    next(error);
  }
}
