import { geminiClient } from './gemini.client.js';
import { config } from '../../config/env.js';

export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_MODEL = 'text-embedding-004';

export const embeddingService = {
  /**
   * Generates and validates the configured model's 768-dimensional vector.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!config.GEMINI_API_KEY) {
      return generateDeterministicEmbedding(text);
    }

    try {
      const response = await geminiClient.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      });

      const values = response.embeddings?.[0]?.values;
      if (Array.isArray(values)) {
        return validateEmbedding(values);
      }
      throw new Error('Gemini embedding returned no vector');
    } catch (error) {
      // Provider errors can include request details; avoid logging or rethrowing
      // potentially sensitive provider payloads and credentials.
      if (error instanceof Error && error.message.startsWith('Embedding must contain')) throw error;
      void error;
      throw new Error('Gemini embedding generation failed');
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

export function validateEmbedding(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSION || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding must contain exactly ${EMBEDDING_DIMENSION} finite values`);
  }
  return vector;
}

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
