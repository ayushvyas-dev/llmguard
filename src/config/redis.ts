import { Redis } from 'ioredis';

import { config } from './env.js';
import logger from './logger.js';

const redis = new Redis(config.UPSTASH_REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,

  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});

redis.on('connect', () => {
  logger.info('Redis connection established');
});

redis.on('ready', () => {
  logger.info('Redis connection ready');
});

redis.on('reconnecting', (delay: number) => {
  logger.warn({ delay }, 'Redis reconnecting');
});

redis.on('error', (error: Error) => {
  logger.error({ err: error }, 'Redis connection error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

export default redis;
