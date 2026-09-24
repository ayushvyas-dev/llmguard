import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env if you aren't doing it via start scripts
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  // FRONTEND_URL: z.string().url(),
  DATABASE_URL: z.string(),
  DIRECT_URL: z.string(),
  // UPSTASH_REDIS_REST_URL: z.string(),
  // UPSTASH_REDIS_REST_TOKEN: z.string(),
  UPSTASH_REDIS_URL: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:', parsed.error.format());
  process.exit(1); // Kill the server instantly
}

export const config = parsed.data;
