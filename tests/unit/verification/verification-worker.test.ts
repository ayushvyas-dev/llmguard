import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '../../../src/config/database.js';
import { claimExtractor } from '../../../src/modules/verification/claim-extractor.js';
import { evidenceRetriever } from '../../../src/modules/verification/evidence-retriever.js';
import { claimVerifier } from '../../../src/modules/verification/claim-verifier.js';
import { processVerificationJob } from '../../../src/jobs/verification/verification.worker.js';

describe('verification worker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes duplicate claims, retrieves evidence, verifies, and persists results', async () => {
    const jobId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    const apiKeyId = 'e8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    vi.spyOn(prisma.verificationJob, 'update').mockResolvedValue({} as never);
    const createClaim = vi.spyOn(prisma.claim, 'create').mockResolvedValue({} as never);
    vi.spyOn(claimExtractor, 'extract').mockResolvedValue([' PostgreSQL is open source. ', 'postgresql   is open source.', 'PostgreSQL began at Berkeley.']);
    const evidence = [{ documentId: 'doc-1', similarity: 0.88, text: 'PostgreSQL is an open-source system.' }];
    const retrieve = vi.spyOn(evidenceRetriever, 'retrieve').mockResolvedValue(evidence);
    const verify = vi.spyOn(claimVerifier, 'verify').mockImplementation(async (claim) => ({ claim, status: 'supported', confidence: 0.9, evidence }));

    await processVerificationJob({ verificationJobId: jobId, apiKeyId, answer: 'Answer with two claims.' });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(createClaim).toHaveBeenCalledTimes(2);
    expect(prisma.verificationJob.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
  });

  it('marks a failed verification job when claim extraction fails', async () => {
    const jobId = 'd8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    const apiKeyId = 'e8c7c10b-8d76-4d2c-80a5-f86a9f4c0291';
    const update = vi.spyOn(prisma.verificationJob, 'update').mockResolvedValue({} as never);
    vi.spyOn(claimExtractor, 'extract').mockRejectedValue(new Error('provider unavailable'));

    await expect(processVerificationJob({ verificationJobId: jobId, apiKeyId, answer: 'Claim.' })).rejects.toThrow('provider unavailable');
    expect(update).toHaveBeenLastCalledWith({ where: { id: jobId }, data: { status: 'FAILED' } });
  });
});
