import { geminiClient } from './gemini.client.js';
import { config } from '../../config/env.js';
import logger from '../../config/logger.js';

export const embeddingService = {
  /**
   * Generates a 768-dimensional embedding vector for the given text.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!config.GEMINI_API_KEY) {
      return generateDeterministicEmbedding(text);
    }

    try {
      const response = await geminiClient.models.embedContent({
        model: 'text-embedding-004',
        contents: text,
      });

      const values = response.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }

      logger.warn('Gemini embedding returned empty values, using deterministic fallback');
      return generateDeterministicEmbedding(text);
    } catch (error) {
      logger.error({ err: error }, 'Gemini embedding generation failed, using fallback');
      return generateDeterministicEmbedding(text);
    }
  },

  /**
   * Calculates cosine similarity between two numeric vectors.
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i] ?? 0;
      const b = vecB[i] ?? 0;
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  },
};

/**
 * Generates a reproducible pseudo-random 768-dim normalized embedding based on character tokens.
 * Useful for development and test environments when API keys are not supplied.
 */
function generateDeterministicEmbedding(text: string, dimension = 768): number[] {
  const vector = new Array<number>(dimension).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const index = (charCode * 31 + i * 17) % dimension;
    const current = vector[index] ?? 0;
    vector[index] = current + Math.sin(charCode + i);
  }

  // Normalize vector to unit length
  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    const val = vector[i] ?? 0;
    sumSq += val * val;
  }

  const norm = Math.sqrt(sumSq) || 1;
  return vector.map((v) => Number((v / norm).toFixed(6)));
}
