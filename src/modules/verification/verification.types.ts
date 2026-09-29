export interface VerifyRequest {
  answer: string;
  context?: string | undefined;
}

export interface VerifyJobResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: VerificationResult | null;
}

export interface EvidenceItem {
  documentId: string;
  similarity: number;
  text: string;
}

export interface ClaimVerificationItem {
  claim: string;
  status: 'supported' | 'unsupported' | 'uncertain';
  confidence: number;
  evidence: EvidenceItem[];
}

export interface VerificationResult {
  claims: ClaimVerificationItem[];
}

export interface DocumentCreateInput {
  content: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface DocumentResponse {
  id: string;
  status: 'pending' | 'embedding_queued' | 'ready' | 'failed';
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}
