/**
 * Default tool policies for common dangerous operations.
 * These are used when no explicit policy is registered.
 */

export interface DefaultToolPolicy {
  pattern: RegExp;
  riskLevel: string;
  requiresApproval: boolean;
  reason: string;
  riskScore: number;
}

export const dangerousToolPatterns: DefaultToolPolicy[] = [
  {
    pattern: /(^|[._:-])(send[_-]?email|sendemail|email[_-]?send|delete[_-]?file|deletefile|execute[_-]?sql|executesql|run[_-]?shell|runshell|transfer[_-]?money|transfermoney)([._:-]|$)/i,
    riskLevel: 'critical',
    requiresApproval: true,
    reason: 'Sensitive external, destructive, execution, or financial tool requires approval.',
    riskScore: 95,
  },
  // Destructive operations
  {
    pattern: /\.(delete|remove|destroy|drop|purge|erase|wipe)/i,
    riskLevel: 'critical',
    requiresApproval: true,
    reason: 'Destructive operation detected.',
    riskScore: 95,
  },
  // Write/modify operations
  {
    pattern: /\.(update|modify|patch|put|set|change|alter|mutate)/i,
    riskLevel: 'high',
    requiresApproval: false,
    reason: 'Write operation detected.',
    riskScore: 60,
  },
  // Create operations
  {
    pattern: /\.(create|add|insert|post|push|new|generate)/i,
    riskLevel: 'medium',
    requiresApproval: false,
    reason: 'Create operation detected.',
    riskScore: 40,
  },
  // Execute/run operations
  {
    pattern: /\.(exec|execute|run|invoke|trigger|deploy|publish)/i,
    riskLevel: 'high',
    requiresApproval: true,
    reason: 'Execution operation requires approval.',
    riskScore: 75,
  },
  // Admin/system operations
  {
    pattern: /\.(admin|sudo|root|system|config|setting|permission|grant|revoke)/i,
    riskLevel: 'critical',
    requiresApproval: true,
    reason: 'Administrative operation detected.',
    riskScore: 90,
  },
  // File system operations
  {
    pattern: /\.(write|writeFile|unlink|rmdir|format|mkfs)/i,
    riskLevel: 'critical',
    requiresApproval: true,
    reason: 'File system operation detected.',
    riskScore: 92,
  },
  // Network/external operations
  {
    pattern: /\.(send|email|sms|notify|webhook|forward|transfer)/i,
    riskLevel: 'high',
    requiresApproval: false,
    reason: 'External communication operation detected.',
    riskScore: 65,
  },
];

/**
 * Dangerous argument patterns that increase risk regardless of tool.
 */
export const dangerousArgumentPatterns: Array<{
  key: RegExp;
  value: RegExp;
  reason: string;
  additionalRisk: number;
}> = [
  {
    key: /^(command|cmd|shell|exec|script|query|sql)$/i,
    value: /.+/,
    reason: 'Tool argument contains executable content.',
    additionalRisk: 20,
  },
  {
    key: /^(url|endpoint|host|server|target)$/i,
    value: /^(http|ftp|ssh|telnet)/i,
    reason: 'Tool argument contains an external URL.',
    additionalRisk: 10,
  },
  {
    key: /^(password|secret|token|key|credential)$/i,
    value: /.+/,
    reason: 'Tool argument contains sensitive credentials.',
    additionalRisk: 15,
  },
];
