import { piiPatterns } from './pii.patterns.js';
import type { Detection } from '../../shared/types/index.js';
import type { PiiDetectionResult } from './pii.types.js';

/**
 * Detect PII in the given text using regex patterns.
 * Returns all matches with their positions.
 */
export function detectPii(input: string): PiiDetectionResult {
  const detections: Detection[] = [];

  for (const piiPattern of piiPatterns) {
    // Reset regex lastIndex for global patterns
    piiPattern.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = piiPattern.pattern.exec(input)) !== null) {
      const matchedText = match[0];

      // Run optional validator (e.g., Luhn check for credit cards)
      if (piiPattern.validator && !piiPattern.validator(matchedText)) {
        continue;
      }

      detections.push({
        type: 'pii',
        subtype: piiPattern.subtype,
        confidence: piiPattern.confidence,
        start: match.index,
        end: match.index + matchedText.length,
      });
    }
  }

  return {
    hasPii: detections.length > 0,
    detections,
  };
}

/**
 * Redact detected PII from the input string.
 */
export function redactPii(input: string, detections: Detection[]): string {
  // Sort detections by start position descending so we can replace from end to start
  const sorted = [...detections]
    .filter((d) => d.start !== undefined && d.end !== undefined)
    .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));

  let result = input;
  for (const detection of sorted) {
    if (detection.start !== undefined && detection.end !== undefined) {
      const replacement = `[${(detection.subtype ?? detection.type).toUpperCase()}_REDACTED]`;
      result =
        result.slice(0, detection.start) +
        replacement +
        result.slice(detection.end);
    }
  }

  return result;
}
