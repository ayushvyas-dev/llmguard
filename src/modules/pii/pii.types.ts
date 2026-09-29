import type { Detection } from '../../shared/types/index.js';

export interface PiiDetectionResult {
  hasPii: boolean;
  detections: Detection[];
}
