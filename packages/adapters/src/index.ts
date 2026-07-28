import type { Adapter, SourceProbe } from '@tokray/core';
import { claudeCodeAdapter } from './claude-code/index.js';
import { codexAdapter } from './codex/index.js';
import { rawRequestAdapter } from './raw-request/index.js';

export { claudeCodeAdapter, codexAdapter, rawRequestAdapter };
export { BlockBuilder, defineAdapter } from './sdk.js';
export { createDeclarativeAdapter, validateDeclarativeAdapterDefinition, valueAtPointer } from './declarative.js';
export type {
  DeclarativeAdapterDefinition,
  DeclarativeDefinitionIssue,
  DeclarativeField,
  DeclarativeMatch,
  DeclarativeMessagesMapping,
  DeclarativeTimestampField,
  DeclarativeToolsMapping,
  DeclarativeUsageMapping,
} from './declarative.js';
export { schemaPrior } from './claude-code/priors.js';
export { splitLines } from './lines.js';
export { redactLine } from './redact.js';

export const adapters: readonly Adapter[] = [claudeCodeAdapter, codexAdapter, rawRequestAdapter];

/** Pick the best-scoring adapter for a source, or null when nothing matches. */
export function detectAdapter(probe: SourceProbe, candidates: readonly Adapter[] = adapters): Adapter | null {
  let best: { adapter: Adapter; score: number } | null = null;
  for (const adapter of candidates) {
    const result = adapter.detect(probe);
    if (result.match && (best === null || result.score > best.score)) {
      best = { adapter, score: result.score };
    }
  }
  return best?.adapter ?? null;
}
