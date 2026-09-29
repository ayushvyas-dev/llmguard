import { groqService } from '../../integrations/groq/groq.service.js';
import type { ClaimVerificationItem, EvidenceItem } from './verification.types.js';

export const claimVerifier = {
  async verify(
    claim: string,
    evidence: EvidenceItem[],
  ): Promise<ClaimVerificationItem> {
    const evidenceTexts = evidence.map((e) => e.text);
    const verification = await groqService.verifyClaim(claim, evidenceTexts);

    return {
      claim,
      status: verification.status,
      confidence: verification.confidence,
      evidence,
    };
  },
};
