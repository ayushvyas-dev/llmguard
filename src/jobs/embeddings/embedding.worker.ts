import { Worker, type Job } from 'bullmq';
import { queueConnection } from '../queues.js';
import prisma from '../../config/database.js';
import logger from '../../config/logger.js';
import { embeddingService } from '../../integrations/gemini/embedding.service.js';
import type { EmbeddingJobData } from './embedding.queue.js';

export async function processEmbeddingJob(data: EmbeddingJobData): Promise<void> {
  const { documentId, content } = data;

  try {
    // Split content into chunks
    const chunks = chunkText(content, 500, 50);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] ?? '';
      // Generate embedding vector
      await embeddingService.generateEmbedding(chunk);

      // Persist chunk to database
      await prisma.embedding.create({
        data: {
          documentId,
          chunkIndex: i,
          chunkText: chunk,
        },
      });
    }

    // Update document status to READY
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY' },
    });

    logger.info({ documentId, chunksCount: chunks.length }, 'Embedding job completed successfully');
  } catch (error) {
    logger.error({ err: error, documentId }, 'Embedding job failed');
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    }).catch(() => {});
    throw error;
  }
}

export function startEmbeddingWorker(): Worker<EmbeddingJobData> {
  const worker = new Worker<EmbeddingJobData>(
    'embeddings',
    async (job: Job<EmbeddingJobData>) => {
      await processEmbeddingJob(job.data);
    },
    {
      connection: queueConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Embedding worker completed job');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Embedding worker job failed');
  });

  return worker;
}

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex < text.length) {
      // Try to break on whitespace or punctuation
      const lastSpace = text.lastIndexOf(' ', endIndex);
      if (lastSpace > startIndex) {
        endIndex = lastSpace;
      }
    } else {
      endIndex = text.length;
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    startIndex = endIndex - overlap;
    if (startIndex >= text.length - overlap) {
      break;
    }
  }

  return chunks;
}
