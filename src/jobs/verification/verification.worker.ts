import { Worker, type Job } from 'bullmq';
import { queueConnection } from '../queues.js';
import prisma from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import logger from '../../config/logger.js';
import { claimExtractor } from '../../modules/verification/claim-extractor.js';
import { evidenceRetriever } from '../../modules/verification/evidence-retriever.js';
import { claimVerifier } from '../../modules/verification/claim-verifier.js';
import type { VerificationJobData } from './verification.queue.js';
import type { ClaimVerificationItem } from '../../modules/verification/verification.types.js';

export async function processVerificationJob(data: VerificationJobData): Promise<void> {
  const { verificationJobId, apiKeyId, answer, context } = data;
  const totalStarted = performance.now();

  try {
    // 1. Mark status as PROCESSING
    await prisma.verificationJob.update({
      where: { id: verificationJobId },
      data: { status: 'PROCESSING' },
    });

    // 2. Extract claims
    const extractionStarted = performance.now();
    const extractedClaims = await claimExtractor.extract(answer, context);
    const claims = [...new Map(
      extractedClaims
        .map((claim) => claim.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .map((claim) => [claim.toLocaleLowerCase(), claim] as const),
    ).values()];
    const extractionLatencyMs = Math.round(performance.now() - extractionStarted);
    const verifiedItems: ClaimVerificationItem[] = [];
    const retrievalLatencies: number[] = [];
    const verificationLatencies: number[] = [];

    // 3. Retrieve evidence and verify each claim
    for (const claimText of claims) {
      const retrievalStarted = performance.now();
      const evidence = await evidenceRetriever.retrieve(apiKeyId, claimText);
      retrievalLatencies.push(performance.now() - retrievalStarted);
      const verificationStarted = performance.now();
      const verified = await claimVerifier.verify(claimText, evidence);
      verificationLatencies.push(performance.now() - verificationStarted);
      verifiedItems.push(verified);

      // Persist individual claim to database
      await prisma.claim.create({
        data: {
          verificationJobId,
          claim: verified.claim,
          status: verified.status,
          confidence: verified.confidence,
          evidence: verified.evidence as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // 4. Update job to COMPLETED with structured result
    const resultJson = { claims: verifiedItems };

    await prisma.verificationJob.update({
      where: { id: verificationJobId },
      data: {
        status: 'COMPLETED',
        result: resultJson as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info({
      verificationJobId,
      claimsCount: verifiedItems.length,
      extractionLatencyMs,
      retrievalLatencyMs: retrievalLatencies.map(Math.round),
      verificationLatencyMs: verificationLatencies.map(Math.round),
      totalLatencyMs: Math.round(performance.now() - totalStarted),
      embeddingProviderCalls: verifiedItems.length,
    }, 'Verification job completed successfully');
  } catch (error) {
    logger.error({ err: error, verificationJobId }, 'Verification job failed');
    await prisma.verificationJob.update({
      where: { id: verificationJobId },
      data: { status: 'FAILED' },
    }).catch(() => {});
    throw error;
  }
}

export function startVerificationWorker(): Worker<VerificationJobData> {
  const worker = new Worker<VerificationJobData>(
    'verification',
    async (job: Job<VerificationJobData>) => {
      await processVerificationJob(job.data);
    },
    {
      connection: queueConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Verification worker completed job');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Verification worker job failed');
  });

  return worker;
}
