import { z } from 'zod';

export const scanSchema = z.object({
  type: z.enum(['prompt', 'text', 'response']),
  input: z.string().trim().min(1).max(50_000),
  context: z.array(z.object({ source: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/), trust: z.enum(['trusted','untrusted']), content: z.string().min(1).max(50_000) })).max(20).optional(),
  policy: z.enum(['balanced','strict','permissive']).optional(),
  intendedOperation: z.string().trim().min(1).max(120).optional(),
  operationRisk: z.enum(['low','medium','high','critical']).optional(),
  sensitivity: z.enum(['public','internal','sensitive','critical']).optional(),
  semanticAnalysis: z.boolean().optional(),
});
export const contentScanSchema = z.object({
  content: z.string().min(1).max(50_000),
  source: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/).default('external_content'),
  trust: z.enum(['trusted','untrusted']).default('untrusted'),
  intendedOperation: z.string().min(1).max(120).default('summarization'),
  operationRisk: z.enum(['low','medium','high','critical']).optional(),
  sensitivity: z.enum(['public','internal','sensitive','critical']).optional(),
  semanticAnalysis: z.boolean().optional(),
  policy: z.enum(['balanced','strict','permissive']).optional(),
});

export type ScanRequest = z.infer<typeof scanSchema>;
