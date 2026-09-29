import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env if you aren't doing it via start scripts
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  DATABASE_URL: z.string().default('postgresql://user:password@localhost:5432/llmguard?schema=public'),
  DIRECT_URL: z.string().default(process.env['DATABASE_URL'] ?? 'postgresql://user:password@localhost:5432/llmguard?schema=public'),
  UPSTASH_REDIS_URL: z.string().default(process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
  REDIS_URL: z.string().optional(),
  GROQ_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  API_KEY_PEPPER: z.string().default('llmguard-default-pepper'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RATE_LIMIT_MAX: z.string().default('100'),
  RATE_LIMIT_WINDOW_SECONDS: z.string().default('60'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
