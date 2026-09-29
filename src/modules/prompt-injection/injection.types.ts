import type { Detection } from '../../shared/types/index.js';

export interface InjectionDetectionResult {
  isInjection: boolean;
  detections: Detection[];
  highestConfidence: number;
}
