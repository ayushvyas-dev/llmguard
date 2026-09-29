export interface PiiPattern {
  id: string;
  subtype: string;
  pattern: RegExp;
  confidence: number;
  /** Used for Luhn validation on card numbers */
  validator?: (match: string) => boolean;
}

/**
 * Luhn algorithm check for credit card numbers.
 */
function isValidLuhn(digits: string): boolean {
  const cleaned = digits.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(cleaned)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let n = parseInt(cleaned[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export const piiPatterns: PiiPattern[] = [
  // Email addresses
  {
    id: 'email',
    subtype: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    confidence: 1.0,
  },

  // Phone numbers (international & Indian formats)
  {
    id: 'phone_international',
    subtype: 'phone',
    pattern: /\+?\d{1,4}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    confidence: 0.85,
  },

  // Indian PAN number
  {
    id: 'pan',
    subtype: 'pan',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    confidence: 0.95,
  },

  // Aadhaar-like patterns (12 digits, possibly space-separated in groups of 4)
  {
    id: 'aadhaar',
    subtype: 'aadhaar',
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    confidence: 0.80,
  },

  // Credit/Debit card numbers (13-19 digits, possibly space/dash separated)
  {
    id: 'credit_card',
    subtype: 'credit_card',
    pattern: /\b(?:\d{4}[\s-]?){3,4}\d{1,4}\b/g,
    confidence: 0.90,
    validator: isValidLuhn,
  },

  // IPv4 addresses
  {
    id: 'ipv4',
    subtype: 'ip_address',
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.90,
  },

  // IPv6 addresses (simplified)
  {
    id: 'ipv6',
    subtype: 'ip_address',
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: 0.85,
  },

  // API keys / secrets (common patterns)
  {
    id: 'api_key_generic',
    subtype: 'api_key',
    pattern:
      /\b(?:sk|pk|api|key|token|secret|password)[-_]?[a-zA-Z0-9]{20,}\b/gi,
    confidence: 0.75,
  },
  {
    id: 'api_key_prefixed',
    subtype: 'api_key',
    pattern:
      /\b(?:sk-|pk-|api-|token-|ghp_|gho_|github_pat_|xoxb-|xoxp-|Bearer\s+)[a-zA-Z0-9_-]{10,}\b/g,
    confidence: 0.90,
  },

  // AWS access keys
  {
    id: 'aws_key',
    subtype: 'api_key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: 0.95,
  },

  // SSN (US Social Security Number)
  {
    id: 'ssn',
    subtype: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.90,
  },
];
