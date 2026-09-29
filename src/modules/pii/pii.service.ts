import { detectPii, redactPii } from './pii.detector.js';
import type { PiiDetectionResult } from './pii.types.js';
import type { Detection } from '../../shared/types/index.js';

export const piiService = {
  detect(input: string): PiiDetectionResult {
    return detectPii(input);
  },

  redact(input: string, detections: Detection[]): string {
    return redactPii(input, detections);
  },
};
