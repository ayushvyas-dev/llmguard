import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import logger from '../config/logger.js';

// BullMQ requires maxRetriesPerRequest to be null
const queueConnection = new Redis(config.UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});

queueConnection.on('error', (err) => {
  logger.warn({ err }, 'BullMQ Redis connection error (will retry or fallback)');
});

export const verificationQueue = new Queue('verification', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const embeddingQueue = new Queue('embeddings', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const auditQueue = new Queue('audit', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 500,
  },
});

export { queueConnection };
