import { verificationQueue } from '../queues.js';
import logger from '../../config/logger.js';

export interface VerificationJobData {
  verificationJobId: string;
  apiKeyId: string;
  answer: string;
  context?: string | undefined;
}

export async function enqueueVerificationJob(data: VerificationJobData): Promise<void> {
  try {
    await verificationQueue.add('verify-claims', data);
  } catch (error) {
    logger.error({ err: error, jobId: data.verificationJobId }, 'Failed to enqueue verification job to BullMQ');
  }
}
