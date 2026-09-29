import crypto from 'node:crypto';

/**
 * Generate a prefixed unique ID.
 * Example: req_a1b2c3d4e5f6
 */
export function generateId(prefix: string): string {
  const random = crypto.randomBytes(12).toString('hex');
  return `${prefix}_${random}`;
}
