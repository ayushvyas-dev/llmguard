import type { NextFunction, Request, Response } from 'express';
import { apiKeyService } from './api-key.service.js';
import type { AuthenticatedRequest } from './api-key.types.js';

export async function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        error: {
          code: 'MISSING_API_KEY',
          message: 'API key is required',
        },
      });
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        error: {
          code: 'INVALID_AUTHORIZATION',
          message: 'Authorization header must use Bearer authentication',
        },
      });
    }

    const apiKey = await apiKeyService.authenticate(token);

    if (!apiKey) {
      return res.status(401).json({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid or inactive API key',
        },
      });
    }

    (req as AuthenticatedRequest).apiKey = apiKey;

    next();
  } catch (error) {
    next(error);
  }
}
