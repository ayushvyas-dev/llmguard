const secretKey = /password|secret|token|credential|api[_-]?key|private[_-]?key|authorization/i;
const pii = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?\d[\d ()-]{7,}\d)\b/gi;
const secretValue = /\b(?:Bearer\s+)[A-Za-z0-9._~+/-]+=*|\b(?:sk|pk|ghp|gsk)_[A-Za-z0-9_-]{12,}\b/gi;

/** Remove common credential/PII values before optionally sending tool proposals to a model provider. */
export function sanitizeToolArguments(value: unknown): unknown {
  const visit = (input: unknown, depth: number): unknown => {
    if (depth > 8) return '[DEPTH_LIMIT]';
    if (typeof input === 'string') return input.slice(0, 2_000).replace(secretValue, '[REDACTED_SECRET]').replace(pii, '[REDACTED_PII]');
    if (Array.isArray(input)) return input.slice(0, 100).map((item) => visit(item, depth + 1));
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).slice(0, 100).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED_SECRET]' : visit(item, depth + 1)]));
    }
    return input;
  };
  const sanitized = visit(value, 0);
  const serialized = JSON.stringify(sanitized);
  return serialized.length > 12_000 ? `${serialized.slice(0, 12_000)}…[TRUNCATED]` : sanitized;
}
