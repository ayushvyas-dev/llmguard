import { detectInjection } from './injection.detector.js';
import type { InjectionDetectionResult } from './injection.types.js';

export const promptInjectionService = {
  detect(input: string): InjectionDetectionResult {
    return detectInjection(input);
  },
};
