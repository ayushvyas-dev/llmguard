import { embeddingQueue } from '../queues.js';
import logger from '../../config/logger.js';

export interface EmbeddingJobData {
  documentId: string;
  apiKeyId: string;
  content: string;
}

export async function enqueueEmbeddingJob(data: EmbeddingJobData): Promise<void> {
  try {
    await embeddingQueue.add('generate-embeddings', data);
  } catch (error) {
    logger.error({ err: error, documentId: data.documentId }, 'Failed to enqueue embedding job to BullMQ');
  }
}
