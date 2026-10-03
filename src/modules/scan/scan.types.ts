export type ScanInputType = 'prompt' | 'text' | 'response';

export interface InternalScanRequest {
  type: ScanInputType;
  input: string;
  requestId: string;
  apiKeyId: string;
  context?: Array<{ source: string; trust: 'trusted' | 'untrusted'; content: string }>;
  policy?: 'balanced' | 'strict' | 'permissive';
  inputSource?: string;
  inputTrust?: 'trusted' | 'untrusted';
  intendedOperation?: string;
}
