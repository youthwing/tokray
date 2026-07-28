/**
 * Token estimation heuristics.
 *
 * Claude has no public local tokenizer, so raw estimates here are heuristic
 * by design. They are never presented as truth: calibration (see calibrate.ts)
 * anchors them against per-frame API usage, and every derived count carries
 * method + errorBand per the TokenCount contract.
 */

import type { BlockFeatures, ContentHash, TokenEstimator } from './types.js';

/**
 * Estimate tokens for a text. Char-class based:
 * - CJK: ~1.15 tokens per character
 * - other non-ASCII: ~1 token per 2 chars
 * - ASCII: ~1 token per 3.8 chars (blend of prose and code)
 *
 * Systematic bias is expected and acceptable — calibration absorbs it with a
 * per-session scale factor. What matters is being monotone and stable.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let ascii = 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) ascii++;
    else if (
      (c >= 0x4e00 && c <= 0x9fff) || // CJK unified
      (c >= 0x3400 && c <= 0x4dbf) || // CJK ext A
      (c >= 0x3000 && c <= 0x30ff) || // CJK punct + kana
      (c >= 0xac00 && c <= 0xd7af) || // Hangul
      (c >= 0xff00 && c <= 0xffef)    // full-width forms
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(ascii / 3.8 + cjk * 1.15 + other / 2);
}

/** Default strategy for adapters whose provider tokenizer is unavailable. */
export const heuristicTokenEstimator: TokenEstimator = {
  id: 'char-class-v1',
  estimate(text) {
    const value = estimateTokens(text);
    return {
      value,
      method: 'calibrated-heuristic',
      errorBand: [Math.max(0, Math.round(value * 0.6)), Math.round(value * 1.6)],
    };
  },
};

/**
 * Two independent 32-bit FNV-1a lanes over UTF-16 code units, hex encoded.
 * Fast, non-cryptographic. Both lanes hash the FULL code unit with different
 * seeds — splitting by byte would make the high lane degenerate to a length
 * counter on ASCII input, which is what most tool results are.
 */
export function contentHash(text: string): ContentHash {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0xcbf29ce4 | 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return (hex(h1) + hex(h2)) as ContentHash;
}

const COMMON_IDENTIFIERS = new Set([
  'about', 'after', 'again', 'also', 'assistant', 'before', 'being', 'context', 'could', 'every',
  'from', 'have', 'into', 'just', 'message', 'model', 'other', 'should', 'system', 'their', 'there',
  'these', 'they', 'this', 'through', 'tool', 'using', 'user', 'with', 'would',
]);

/**
 * Compact, irreversible features for compaction alignment. Text is chunked
 * before hashing and only salient identifiers survive. This gives the diff
 * engine evidence without retaining message or tool-result bodies in memory.
 */
export function blockFeatures(text: string): BlockFeatures {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chunks: ContentHash[] = [];
  const chunkSize = 192;
  const overlap = 48;
  for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
    const chunk = normalized.slice(start, start + chunkSize);
    if (chunk.length > 0) chunks.push(contentHash(chunk));
    if (start + chunkSize >= normalized.length) break;
  }

  const identifiers = normalized.match(/[A-Za-z_$][A-Za-z0-9_$./:@-]{3,}|[\u3400-\u9fff]{2,}/g) ?? [];
  const idents: string[] = [];
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    const value = identifier.toLocaleLowerCase();
    if (COMMON_IDENTIFIERS.has(value) || seen.has(value)) continue;
    seen.add(value);
    idents.push(value);
    if (idents.length >= 96) break;
  }
  return { chunks, idents };
}
