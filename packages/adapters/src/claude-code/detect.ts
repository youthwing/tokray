import type { SourceProbe } from '@tokray/core';

/** Record types that positively identify a Claude Code session log. */
const SIGNATURE_TYPES = ['assistant', 'user', 'attachment', 'system', 'summary'];

/**
 * Cheap detection over the first 64 KiB. The probe may end mid-line or even
 * mid-character; only complete lines are considered.
 */
export function detectClaudeCode(probe: SourceProbe): { match: boolean; score: number; note?: string } {
  const lines = probe.head.split('\n');
  // The last element is likely truncated; drop it unless it is the only one.
  const candidates = (lines.length > 1 ? lines.slice(0, -1) : lines).filter((l) => l.trim().length > 0);
  if (candidates.length === 0) return { match: false, score: 0, note: 'empty probe' };

  let parsed = 0;
  let signature = 0;
  let sessionId = 0;
  for (const line of candidates.slice(0, 50)) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      parsed++;
      if (typeof rec['type'] === 'string' && SIGNATURE_TYPES.includes(rec['type'] as string)) signature++;
      if (typeof rec['sessionId'] === 'string') sessionId++;
    } catch {
      // Non-JSON line: counts against the ratio below.
    }
  }

  const total = Math.min(candidates.length, 50);
  const parseRatio = parsed / total;
  const signatureRatio = parsed > 0 ? signature / parsed : 0;
  const score = parseRatio * 0.4 + signatureRatio * 0.4 + (sessionId > 0 ? 0.2 : 0);
  const looksLikeName = probe.name?.endsWith('.jsonl') ?? false;

  return {
    match: score >= 0.6 || (score >= 0.4 && looksLikeName),
    score,
    note: `parsed ${parsed}/${total} lines, ${signature} with signature types`,
  };
}
