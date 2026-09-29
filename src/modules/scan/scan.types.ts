export type ScanInputType = 'prompt' | 'text' | 'response';

export interface InternalScanRequest {
  type: ScanInputType;
  input: string;
  requestId: string;
  apiKeyId: string;
}
