import { z } from 'zod';

export const toolValidationSchema = z.object({
  tool: z.string().trim().min(1, 'Tool name is required').max(128).regex(/^[a-zA-Z0-9_.:-]+$/),
  arguments: z.record(z.string().max(128), z.unknown()).default({}).refine((v) => Object.keys(v).length <= 100, 'Too many tool arguments'),
  intendedOperation: z.string().trim().min(1).max(500).optional(),
});

export const toolPolicySchema = z.object({
  name: z.string().min(1, 'Tool policy name is required'),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  enabled: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
});
