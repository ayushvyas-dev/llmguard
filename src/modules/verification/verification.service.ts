import prisma from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { enqueueVerificationJob } from '../../jobs/verification/verification.queue.js';
import { enqueueEmbeddingJob } from '../../jobs/embeddings/embedding.queue.js';
import type {
  VerifyRequest,
  VerifyJobResponse,
  DocumentCreateInput,
  DocumentResponse,
  VerificationResult,
} from './verification.types.js';

export const verificationService = {
  async createJob(apiKeyId: string, input: VerifyRequest): Promise<VerifyJobResponse> {
    const job = await prisma.verificationJob.create({
      data: {
        apiKeyId,
        answer: input.answer,
        context: input.context ?? null,
        status: 'QUEUED',
      },
    });

    await enqueueVerificationJob({
      verificationJobId: job.id,
      apiKeyId,
      answer: input.answer,
      context: input.context,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  },

  async getJob(apiKeyId: string, jobId: string): Promise<VerifyJobResponse> {
    const job = await prisma.verificationJob.findFirst({
      where: {
        id: jobId,
        apiKeyId,
      },
    });

    if (!job) {
      throw new NotFoundError(`Verification job with id '${jobId}' not found.`);
    }

    const status = job.status.toLowerCase() as 'queued' | 'processing' | 'completed' | 'failed';

    const response: VerifyJobResponse = {
      jobId: job.id,
      status,
    };

    if (job.status === 'COMPLETED' && job.result) {
      response.result = job.result as unknown as VerificationResult;
    }

    return response;
  },

  async createDocument(
    apiKeyId: string,
    input: DocumentCreateInput,
  ): Promise<{ documentId: string; status: string }> {
    const doc = await prisma.document.create({
      data: {
        apiKeyId,
        content: input.content,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: 'EMBEDDING_QUEUED',
      },
    });

    await enqueueEmbeddingJob({
      documentId: doc.id,
      apiKeyId,
      content: input.content,
    });

    return {
      documentId: doc.id,
      status: 'embedding_queued',
    };
  },

  async getDocument(apiKeyId: string, documentId: string): Promise<DocumentResponse> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        apiKeyId,
      },
    });

    if (!doc) {
      throw new NotFoundError(`Document with id '${documentId}' not found.`);
    }

    const statusMap: Record<string, DocumentResponse['status']> = {
      PENDING: 'pending',
      EMBEDDING_QUEUED: 'embedding_queued',
      READY: 'ready',
      FAILED: 'failed',
    };

    return {
      id: doc.id,
      status: statusMap[doc.status] ?? 'pending',
      metadata: (doc.metadata as Record<string, unknown> | null) ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  },

  async deleteDocument(
    apiKeyId: string,
    documentId: string,
  ): Promise<{ deleted: boolean; documentId: string }> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        apiKeyId,
      },
    });

    if (!doc) {
      throw new NotFoundError(`Document with id '${documentId}' not found.`);
    }

    await prisma.document.delete({
      where: { id: documentId },
    });

    return {
      deleted: true,
      documentId,
    };
  },
};
