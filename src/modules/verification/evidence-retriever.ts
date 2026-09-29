import prisma from '../../config/database.js';
import { embeddingService } from '../../integrations/gemini/embedding.service.js';
import type { EvidenceItem } from './verification.types.js';

export const evidenceRetriever = {
  /**
   * Retrieves relevant evidence chunks for a given claim and apiKey.
   */
  async retrieve(
    apiKeyId: string,
    claim: string,
    topK = 3,
    threshold = 0.4,
  ): Promise<EvidenceItem[]> {
    const claimEmbedding = await embeddingService.generateEmbedding(claim);

    // Fetch ready documents and embeddings for this API key
    const documents = await prisma.document.findMany({
      where: {
        apiKeyId,
        status: 'READY',
      },
      include: {
        embeddings: true,
      },
    });

    const candidates: EvidenceItem[] = [];

    for (const doc of documents) {
      if (doc.embeddings.length > 0) {
        for (const emb of doc.embeddings) {
          // Generate embedding for chunk text to compare
          const chunkEmbedding = await embeddingService.generateEmbedding(emb.chunkText);
          const similarity = embeddingService.cosineSimilarity(claimEmbedding, chunkEmbedding);

          if (similarity >= threshold) {
            candidates.push({
              documentId: doc.id,
              similarity: Number(similarity.toFixed(4)),
              text: emb.chunkText,
            });
          }
        }
      } else {
        // Fallback: document has content directly
        const docEmbedding = await embeddingService.generateEmbedding(doc.content);
        const similarity = embeddingService.cosineSimilarity(claimEmbedding, docEmbedding);

        if (similarity >= threshold) {
          candidates.push({
            documentId: doc.id,
            similarity: Number(similarity.toFixed(4)),
            text: doc.content.slice(0, 500),
          });
        }
      }
    }

    // Sort descending by similarity and take topK
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, topK);
  },
};
