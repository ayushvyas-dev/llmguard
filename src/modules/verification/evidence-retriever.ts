import prisma from '../../config/database.js';
import { embeddingService, validateEmbedding } from '../../integrations/gemini/embedding.service.js';
import type { EvidenceItem } from './verification.types.js';

export const evidenceRetriever = {
  /** One provider embedding followed by one tenant-scoped PostgreSQL cosine search. */
  async retrieve(apiKeyId: string, claim: string, topK = 3, threshold = 0.4): Promise<EvidenceItem[]> {
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) throw new Error('topK must be an integer between 1 and 100');
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error('threshold must be between -1 and 1');

    const vector = JSON.stringify(validateEmbedding(await embeddingService.generateEmbedding(claim)));
    const rows = await prisma.$queryRaw<Array<{ documentId: string; similarity: number; text: string }>>`
      SELECT e."documentId" AS "documentId",
             1 - (e."embedding" <=> ${vector}::vector) AS "similarity",
             e."chunkText" AS "text"
      FROM "embeddings" e
      INNER JOIN "documents" d ON d."id" = e."documentId"
      WHERE d."apiKeyId" = ${apiKeyId}::uuid
        AND d."status" = 'READY'
        AND e."embedding" IS NOT NULL
        AND 1 - (e."embedding" <=> ${vector}::vector) >= ${threshold}
      ORDER BY e."embedding" <=> ${vector}::vector ASC
      LIMIT ${topK}
    `;

    return rows.filter((row) => Number.isFinite(Number(row.similarity)) && typeof row.text === 'string')
      .map((row) => ({ documentId: row.documentId, similarity: Number(Number(row.similarity).toFixed(4)), text: row.text }));
  },
};
