/** Conservative canonicalization for detector input. Original caller data is never changed. */
export function normalizeForSecurity(input: string): { text: string; signals: string[] } {
  const signals: string[] = [];
  let text = input.normalize('NFKC').replace(/[\u200B-\u200F\uFEFF\u2060]/g, '');
  if (text !== input) signals.push('unicode_or_zero_width');
  text = text.replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ');
  text = text.replace(/(.)\1{5,}/gu, '$1$1$1');
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) signals.push('url_encoded');
    text = decoded;
  } catch { /* malformed escapes are retained as data */ }
  text = text.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|amp|lt|gt|quot|apos);/gi, (entity, hex, dec) => {
    if (hex || dec) {
      const point = parseInt(hex || dec, hex ? 16 : 10);
      return Number.isFinite(point) && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    }
    return ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
  const leet = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/&(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);|[A-Za-z0-9@$!]{3,}/gi, (token) => {
    if (token.startsWith('&') || token.length >= 32 || !/[a-z]/i.test(token)) return token;
    return token.replace(/[0@$!]/g, (c) => ({ '0': 'o', '@': 'a', '$': 's', '!': 'i' })[c] ?? c);
  });
  if (leet !== text) signals.push('common_leetspeak');
  const encoded = text.match(/(?:^|\s)([A-Za-z0-9+/]{40,}={0,2})(?=\s|$)/)?.[1];
  if (encoded && encoded.length % 4 === 0) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const printable = [...decoded].filter((c) => /[\p{L}\p{N}\p{P}\p{Z}]/u.test(c)).length;
    if (decoded.length >= 24 && printable / decoded.length > 0.85) {
      signals.push('base64_like_content');
      text = `${text}\n${decoded}`;
    }
  }
  return { text, signals: [...new Set(signals)] };
}
