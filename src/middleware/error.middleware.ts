import type { Request, Response, NextFunction } from 'express';
import logger from '../config/logger.js';
import { AppError, RateLimitError } from '../shared/errors/index.js';

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof RateLimitError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.id,
        retryAfter: err.retryAfter,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.id,
      },
    });
    return;
  }

  // Unexpected errors
  logger.error({ err, requestId: req.id }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: req.id,
    },
  });
}
