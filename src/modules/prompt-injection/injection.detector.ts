import { injectionRules } from './injection.rules.js';
import type { Detection } from '../../shared/types/index.js';
import type { InjectionDetectionResult } from './injection.types.js';

/**
 * Stateless prompt injection detector.
 * Runs all rule-based patterns against the input text.
 */
export function detectInjection(input: string): InjectionDetectionResult {
  const detections: Detection[] = [];

  for (const rule of injectionRules) {
    if (rule.pattern.test(input)) {
      detections.push({
        type: 'prompt_injection',
        subtype: rule.subtype,
        confidence: rule.confidence,
        reason: rule.reason,
      });
    }
  }

  const highestConfidence =
    detections.length > 0
      ? Math.max(...detections.map((d) => d.confidence))
      : 0;

  return {
    isInjection: detections.length > 0,
    detections,
    highestConfidence,
  };
}
