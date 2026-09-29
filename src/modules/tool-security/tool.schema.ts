import { z } from 'zod';

export const toolValidationSchema = z.object({
  tool: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const toolPolicySchema = z.object({
  name: z.string().min(1, 'Tool policy name is required'),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  enabled: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
});
