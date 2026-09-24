import crypto from 'node:crypto';

const API_KEY_PREFIX = 'lg_live_';

export function generateApiKey(): {
  key: string;
  prefix: string;
  keyHash: string;
} {
  const randomBytes = crypto.randomBytes(32).toString('hex');

  const key = `${API_KEY_PREFIX}${randomBytes}`;

  return {
    key,
    prefix: key.slice(0, 16),
    keyHash: hashApiKey(key),
  };
}

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}
