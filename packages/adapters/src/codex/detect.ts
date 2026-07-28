import type { SourceProbe } from '@tokray/core';

const TYPES = new Set(['session_meta', 'turn_context', 'response_item', 'event_msg', 'world_state']);

export function detectCodex(probe: SourceProbe): { match: boolean; score: number; note?: string } {
  const lines = probe.head.split('\n').filter((line) => line.trim().length > 0).slice(0, 30);
  let parsed = 0;
  let signature = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      parsed++;
      if (typeof rec['type'] === 'string' && TYPES.has(rec['type'])) signature++;
    } catch {
      // A truncated probe line is expected.
    }
  }
  const score = lines.length > 0 ? signature / lines.length : 0;
  return { match: signature >= 2 && score >= 0.5, score: 0.7 + score * 0.25, note: `${signature}/${lines.length} Codex rollout records` };
}
