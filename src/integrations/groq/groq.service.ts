import { getGroqClient } from './groq.client.js';
import { config } from '../../config/env.js';
import logger from '../../config/logger.js';

export interface VerifiedClaimOutput {
  status: 'supported' | 'unsupported' | 'uncertain';
  confidence: number;
  reasoning: string;
}

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export const groqService = {
  /**
   * Extract atomic factual claims from an answer
   */
  async extractClaims(answer: string, context?: string): Promise<string[]> {
    if (!config.GROQ_API_KEY) {
      // Deterministic sentence-based claim splitter fallback
      return fallbackExtractClaims(answer);
    }

    try {
      const response = await getGroqClient().chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a factual claim extraction system. Extract discrete, verifiable factual claims from the text.
Each claim should be a standalone factual statement.
Respond ONLY with a valid JSON object in the following format:
{"claims": ["claim 1", "claim 2"]}`,
          },
          {
            role: 'user',
            content: `Text: ${answer}${context ? `\nContext: ${context}` : ''}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return fallbackExtractClaims(answer);
      }

      const parsed = JSON.parse(content) as { claims?: string[] };
      if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
        return parsed.claims.filter(
          (c): c is string => typeof c === 'string' && c.trim().length > 0,
        );
      }

      return fallbackExtractClaims(answer);
    } catch (error) {
      logger.error(
        { err: error },
        'Groq claim extraction failed, using fallback',
      );
      return fallbackExtractClaims(answer);
    }
  },

  /**
   * Verify an individual claim against evidence passages.
   * Categorizes into 'supported', 'unsupported', or 'uncertain'.
   */
  async verifyClaim(
    claim: string,
    evidenceTexts: string[],
  ): Promise<VerifiedClaimOutput> {
    if (evidenceTexts.length === 0) {
      return {
        status: 'uncertain',
        confidence: 0.5,
        reasoning: 'No relevant evidence found to verify the claim.',
      };
    }

    if (!config.GROQ_API_KEY) {
      return fallbackVerifyClaim(claim, evidenceTexts);
    }

    try {
      const prompt = `Claim: "${claim}"\n\nEvidence:\n${evidenceTexts.map((e, idx) => `[${idx + 1}] ${e}`).join('\n\n')}\n\nTask: Verify if the claim is supported by the evidence above.
Classify the status as one of:
- "supported": The evidence directly confirms the claim.
- "unsupported": The evidence contradicts or refutes the claim.
- "uncertain": The evidence does not provide enough information to confirm or refute the claim.

Respond ONLY with valid JSON:
{"status": "supported" | "unsupported" | "uncertain", "confidence": number between 0 and 1, "reasoning": "brief explanation"}`;

      const response = await getGroqClient().chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a rigorous fact-checking verification system.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return fallbackVerifyClaim(claim, evidenceTexts);
      }

      const parsed = JSON.parse(content) as {
        status?: 'supported' | 'unsupported' | 'uncertain';
        confidence?: number;
        reasoning?: string;
      };

      const status =
        parsed.status === 'supported' ||
        parsed.status === 'unsupported' ||
        parsed.status === 'uncertain'
          ? parsed.status
          : 'uncertain';

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.8;

      return {
        status,
        confidence,
        reasoning: parsed.reasoning || `Claim evaluated as ${status}`,
      };
    } catch (error) {
      logger.error(
        { err: error },
        'Groq claim verification failed, using fallback',
      );
      return fallbackVerifyClaim(claim, evidenceTexts);
    }
  },
};

/**
 * Fallback claim extractor when Groq is not reachable or disabled
 */
function fallbackExtractClaims(text: string): string[] {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  return sentences.length > 0 ? sentences : [text.trim()];
}

/**
 * Fallback claim verifier using basic token overlap when Groq is not configured
 */
function fallbackVerifyClaim(
  claim: string,
  evidenceTexts: string[],
): VerifiedClaimOutput {
  const claimWords = claim
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (claimWords.length === 0) {
    return {
      status: 'uncertain',
      confidence: 0.5,
      reasoning:
        'Claim is too short or ambiguous to verify without external LLM.',
    };
  }

  const combinedEvidence = evidenceTexts.join(' ').toLowerCase();
  const matchedWords = claimWords.filter((w) => combinedEvidence.includes(w));
  const ratio = matchedWords.length / claimWords.length;

  if (ratio >= 0.75) {
    return {
      status: 'supported',
      confidence: 0.85,
      reasoning: 'Evidence closely aligns with the factual terms in the claim.',
    };
  }

  if (ratio < 0.25) {
    return {
      status: 'uncertain',
      confidence: 0.5,
      reasoning: 'Insufficient evidence to verify the claim.',
    };
  }

  return {
    status: 'uncertain',
    confidence: 0.6,
    reasoning: 'Partial evidence match; claim cannot be definitively verified.',
  };
}
