import type { Request } from 'express';
import type { ApiKey } from '../../generated/prisma/client.js';

export type AuthenticatedApiKey = Pick<
  ApiKey,
  'id' | 'name' | 'prefix' | 'isActive'
>;

export type AuthenticatedRequest = Request & {
  apiKey: AuthenticatedApiKey;
};
