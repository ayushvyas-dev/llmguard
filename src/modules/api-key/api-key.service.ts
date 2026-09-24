import prisma from '../../config/database.js';
import { hashApiKey, generateApiKey } from './api-key.utils.js';
import type { AuthenticatedApiKey } from './api-key.types.js';

export class ApiKeyService {
  async createApiKey(name: string) {
    const { key, prefix, keyHash } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        prefix,
        keyHash,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key,
      createdAt: apiKey.createdAt,
    };
  }

  async authenticate(apiKey: string): Promise<AuthenticatedApiKey | null> {
    const keyHash = hashApiKey(apiKey);

    const result = await prisma.apiKey.findUnique({
      where: {
        keyHash,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        isActive: true,
      },
    });

    if (!result || !result.isActive) {
      return null;
    }

    return result;
  }

  async revokeApiKey(id: string) {
    return prisma.apiKey.update({
      where: {
        id,
      },
      data: {
        isActive: false,
      },
    });
  }
}

export const apiKeyService = new ApiKeyService();
