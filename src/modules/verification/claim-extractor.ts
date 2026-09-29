import { groqService } from '../../integrations/groq/groq.service.js';

export const claimExtractor = {
  async extract(answer: string, context?: string): Promise<string[]> {
    return groqService.extractClaims(answer, context);
  },
};
