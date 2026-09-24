// import app from './app.js';

// const server = app.listen(5000, () => {
//   console.log(`Server is running on http://localhost:5000/api/v1`);
// });

import app from './app.js';
import { config } from './config/env.js';
import prisma from './config/database.js';
import redis from './config/redis.js';
import logger from './config/logger.js';

async function startServer() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    await redis.connect();
    logger.info('Redis connected');

    const server = app.listen(Number(config.PORT), () => {
      logger.info(
        `Server is running on http://localhost:${config.PORT}/api/v1`,
      );
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down server');

      server.close(async () => {
        await redis.quit();
        await prisma.$disconnect();

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
