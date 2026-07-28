import type { SourceProbe } from '@tokray/core';

export function detectRawRequest(probe: SourceProbe): { match: boolean; score: number; note?: string } {
  const lines = probe.head.split('\n').filter((line) => line.trim().length > 0).slice(0, 10);
  let matches = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      const request = rec['request'] && typeof rec['request'] === 'object'
        ? rec['request'] as Record<string, unknown>
        : rec;
      const complete = rec['type'] === 'model_call';
      const requestLike = typeof request['model'] === 'string'
        && (Array.isArray(request['messages']) || Array.isArray(request['input']));
      if (complete || requestLike) matches++;
    } catch {
      // Detection is intentionally best-effort.
    }
  }
  const score = lines.length > 0 ? matches / lines.length : 0;
  return { match: matches > 0 && score >= 0.5, score: 0.65 + score * 0.25, note: `${matches}/${lines.length} complete request records` };
}
