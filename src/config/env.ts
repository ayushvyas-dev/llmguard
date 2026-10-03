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
  SECURITY_MODE: z.enum(['balanced', 'strict', 'permissive']).default('balanced'),
  CLASSIFIER_FAILURE_MODE: z.enum(['fail_open', 'fail_closed', 'review_on_failure']).default('review_on_failure'),
  CLASSIFIER_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(4_000),
  SEMANTIC_SAMPLING_RATE: z.coerce.number().min(0).max(1).default(0.10),
  SEMANTIC_ANALYZE_UNTRUSTED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SEMANTIC_ANALYZE_SENSITIVE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SEMANTIC_ANALYZE_AMBIGUOUS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SEMANTIC_TOOL_ANALYSIS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
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
