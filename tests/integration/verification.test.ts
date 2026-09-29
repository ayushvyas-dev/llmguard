import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import { apiKeyService } from '../../src/modules/api-key/api-key.service.js';
import prisma from '../../src/config/database.js';
import * as verificationQueueModule from '../../src/jobs/verification/verification.queue.js';
import * as embeddingQueueModule from '../../src/jobs/embeddings/embedding.queue.js';

describe('Verification & Document APIs', () => {
  const mockApiKeyId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiKeyService, 'authenticate').mockResolvedValue({
      id: mockApiKeyId,
      name: 'Test Project',
      prefix: 'lg_live_test123',
      isActive: true,
    });
    vi.spyOn(verificationQueueModule, 'enqueueVerificationJob').mockResolvedValue(undefined);
    vi.spyOn(embeddingQueueModule, 'enqueueEmbeddingJob').mockResolvedValue(undefined);
  });

  it('POST /v1/verify enqueues an asynchronous claim verification job', async () => {
    vi.spyOn(prisma.verificationJob, 'create').mockResolvedValue({
      id: 'job_test_123',
      apiKeyId: mockApiKeyId,
      answer: 'PostgreSQL 18 was released in September 2025.',
      context: 'PostgreSQL is an open-source database.',
      status: 'QUEUED',
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/v1/verify')
      .set('Authorization', 'Bearer lg_live_test')
      .send({
        answer: 'PostgreSQL 18 was released in September 2025.',
        context: 'PostgreSQL is an open-source database.',
      });

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job_test_123');
    expect(res.body.status).toBe('queued');
  });

  it('GET /v1/verify/:jobId returns completed job result', async () => {
    const mockResult = {
      claims: [
        {
          claim: 'PostgreSQL 18 was released in September 2025.',
          status: 'supported',
          confidence: 0.94,
          evidence: [
            {
              documentId: 'doc_123',
              similarity: 0.91,
              text: 'PostgreSQL 18 release announcement in September 2025',
            },
          ],
        },
      ],
    };

    vi.spyOn(prisma.verificationJob, 'findFirst').mockResolvedValue({
      id: 'job_test_123',
      apiKeyId: mockApiKeyId,
      answer: 'PostgreSQL 18 was released in September 2025.',
      context: null,
      status: 'COMPLETED',
      result: mockResult as any,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/v1/verify/job_test_123')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('job_test_123');
    expect(res.body.status).toBe('completed');
    expect(res.body.result.claims[0].status).toBe('supported');
  });

  it('POST /v1/documents ingests document and enqueues embedding', async () => {
    vi.spyOn(prisma.document, 'create').mockResolvedValue({
      id: 'doc_test_123',
      apiKeyId: mockApiKeyId,
      content: 'PostgreSQL is an object-relational database system.',
      metadata: { source: 'postgresql.org' },
      status: 'EMBEDDING_QUEUED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post('/v1/documents')
      .set('Authorization', 'Bearer lg_live_test')
      .send({
        content: 'PostgreSQL is an object-relational database system.',
        metadata: { source: 'postgresql.org' },
      });

    expect(res.status).toBe(200);
    expect(res.body.documentId).toBe('doc_test_123');
    expect(res.body.status).toBe('embedding_queued');
  });

  it('GET /v1/documents/:documentId retrieves document metadata', async () => {
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: 'doc_test_123',
      apiKeyId: mockApiKeyId,
      content: 'PostgreSQL is an object-relational database system.',
      metadata: { source: 'postgresql.org' },
      status: 'READY',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .get('/v1/documents/doc_test_123')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('doc_test_123');
    expect(res.body.status).toBe('ready');
    expect(res.body.metadata.source).toBe('postgresql.org');
  });

  it('DELETE /v1/documents/:documentId deletes document', async () => {
    vi.spyOn(prisma.document, 'findFirst').mockResolvedValue({
      id: 'doc_test_123',
      apiKeyId: mockApiKeyId,
      content: 'Content to delete',
      metadata: null,
      status: 'READY',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.spyOn(prisma.document, 'delete').mockResolvedValue({
      id: 'doc_test_123',
      apiKeyId: mockApiKeyId,
      content: 'Content to delete',
      metadata: null,
      status: 'READY',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .delete('/v1/documents/doc_test_123')
      .set('Authorization', 'Bearer lg_live_test');

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.documentId).toBe('doc_test_123');
  });
});
