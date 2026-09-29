import app from './app.js';
import { config } from './config/env.js';
import prisma from './config/database.js';
import redis from './config/redis.js';
import logger from './config/logger.js';
import { startVerificationWorker } from './jobs/verification/verification.worker.js';
import { startEmbeddingWorker } from './jobs/embeddings/embedding.worker.js';

async function startServer() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    await redis.connect();
    logger.info('Redis connected');

    // Start background queue workers
    const verificationWorker = startVerificationWorker();
    const embeddingWorker = startEmbeddingWorker();
    logger.info('BullMQ workers initialized');

    const server = app.listen(Number(config.PORT), () => {
      logger.info(
        `Server is running on http://localhost:${config.PORT}/v1`,
      );
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down server');

      server.close(async () => {
        await verificationWorker.close().catch(() => {});
        await embeddingWorker.close().catch(() => {});
        await redis.quit().catch(() => {});
        await prisma.$disconnect().catch(() => {});

        logger.info('Server shutdown complete');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');

    await redis.quit().catch(() => {});
    await prisma.$disconnect().catch(() => {});

    process.exit(1);
  }
}

void startServer();
