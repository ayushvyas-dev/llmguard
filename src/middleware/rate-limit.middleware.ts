import type { Request, Response, NextFunction } from 'express';
import redis from '../config/redis.js';
import { config } from '../config/env.js';

const MAX_REQUESTS = Number(config.RATE_LIMIT_MAX) || 100;
const WINDOW_SECONDS = Number(config.RATE_LIMIT_WINDOW_SECONDS) || 60;

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Use API key prefix or IP address as identifier
    const identifier =
      req.headers.authorization?.split(' ')[1]?.slice(0, 16) ||
      req.ip ||
      'unknown';

    const key = `ratelimit:${identifier}`;
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    const ttl = await redis.ttl(key);

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS.toString());
    res.setHeader(
      'X-RateLimit-Remaining',
      Math.max(0, MAX_REQUESTS - current).toString(),
    );
    res.setHeader('X-RateLimit-Reset', ttl.toString());

    if (current > MAX_REQUESTS) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
          requestId: req.id,
          retryAfter: ttl,
        },
      });
      return;
    }

    next();
  } catch (_error) {
    // If Redis is down, allow the request through
    next();
  }
}
