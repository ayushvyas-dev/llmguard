import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../../src/config/database.js';
import { embeddingService } from '../../../src/integrations/gemini/embedding.service.js';
import { evidenceRetriever } from '../../../src/modules/verification/evidence-retriever.js';
import { processEmbeddingJob } from '../../../src/jobs/embeddings/embedding.worker.js';

describe('pgvector evidence path', () => {
  afterEach(() => vi.restoreAllMocks());

  it('generates one query embedding and returns tenant scoped pgvector rows', async () => {
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const generate = vi.spyOn(embeddingService, 'generateEmbedding').mockResolvedValue(vector);
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([
      { documentId: 'doc-1', similarity: 0.91, text: 'matching evidence' },
    ]);

    const evidence = await evidenceRetriever.retrieve('d8c7c10b-8d76-4d2c-80a5-f86a9f4c0291', 'claim');

    expect(generate).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(evidence).toEqual([{ documentId: 'doc-1', similarity: 0.91, text: 'matching evidence' }]);
  });

  it('stores vectors atomically and only marks a non-empty document ready', async () => {
    const documentId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: documentId, apiKeyId: documentId, content: 'test', metadata: null,
      status: 'EMBEDDING_QUEUED', createdAt: new Date(), updatedAt: new Date(),
    });
    const generate = vi.spyOn(embeddingService, 'generateEmbedding').mockResolvedValue(Array(768).fill(0.01));
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const executeRaw = vi.fn().mockResolvedValue(1);
    const update = vi.fn().mockResolvedValue({});
    const tx = { embedding: { deleteMany }, $executeRaw: executeRaw, document: { update } };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));

    await processEmbeddingJob({ documentId, apiKeyId: documentId, content: 'A PostgreSQL evidence passage.' });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { documentId } });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: documentId }, data: { status: 'READY' } });
  });

  it('rejects malformed vectors before database insertion', async () => {
    vi.spyOn(embeddingService, 'generateEmbedding').mockResolvedValue([1, Number.NaN]);
    const transaction = vi.spyOn(prisma, '$transaction');
    const documentId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: documentId, apiKeyId: documentId, content: 'test', metadata: null,
      status: 'EMBEDDING_QUEUED', createdAt: new Date(), updatedAt: new Date(),
    });
    vi.spyOn(prisma.document, 'update').mockResolvedValue({} as never);

    await expect(processEmbeddingJob({ documentId, apiKeyId: documentId, content: 'text' })).rejects.toThrow(/768 finite values/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('marks the document failed and propagates an embedding provider failure', async () => {
    const documentId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: documentId, apiKeyId: documentId, content: 'test', metadata: null,
      status: 'EMBEDDING_QUEUED', createdAt: new Date(), updatedAt: new Date(),
    });
    vi.spyOn(embeddingService, 'generateEmbedding').mockRejectedValue(new Error('Gemini embedding generation failed'));
    const update = vi.spyOn(prisma.document, 'update').mockResolvedValue({} as never);

    await expect(processEmbeddingJob({ documentId, apiKeyId: documentId, content: 'text' })).rejects.toThrow('Gemini embedding generation failed');
    expect(update).toHaveBeenCalledWith({ where: { id: documentId }, data: { status: 'FAILED' } });
  });

  it('rejects an empty document without calling the embedding provider', async () => {
    const documentId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: documentId, apiKeyId: documentId, content: '   ', metadata: null,
      status: 'EMBEDDING_QUEUED', createdAt: new Date(), updatedAt: new Date(),
    });
    const generate = vi.spyOn(embeddingService, 'generateEmbedding');
    vi.spyOn(prisma.document, 'update').mockResolvedValue({} as never);

    await expect(processEmbeddingJob({ documentId, apiKeyId: documentId, content: '   ' })).rejects.toThrow('Cannot embed an empty document');
    expect(generate).not.toHaveBeenCalled();
  });
});
