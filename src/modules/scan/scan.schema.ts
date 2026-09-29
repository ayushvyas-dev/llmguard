import { z } from 'zod';

export const scanSchema = z.object({
  type: z.enum(['prompt', 'text', 'response']),
  input: z.string().trim().min(1).max(50_000),
});

export type ScanRequest = z.infer<typeof scanSchema>;
