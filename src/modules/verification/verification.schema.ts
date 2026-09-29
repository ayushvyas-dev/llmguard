import { z } from 'zod';

export const verifySchema = z.object({
  answer: z.string().min(1, 'Answer is required'),
  context: z.string().optional(),
});

export const documentSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
