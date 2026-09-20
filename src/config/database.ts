import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../generated/prisma/client.js';

import { config } from './env.js';

const adapter = new PrismaNeon({
  connectionString: config.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

export default prisma;
