import type { Request, Response, NextFunction } from 'express';
import { generateId } from '../shared/utils/index.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.id = (req.headers['x-request-id'] as string) || generateId('req');
  next();
}
