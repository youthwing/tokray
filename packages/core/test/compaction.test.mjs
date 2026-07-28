import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignCompaction, buildCompactionEvent } from '../dist/compaction.js';
import { blockFeatures, contentHash, estimateTokens } from '../dist/tokens.js';

function block(id, text, kind, source) {
  return {
    id,
    attribution: { kind, confidence: 'exact', ...(source ? { source } : {}) },
    sourceRef: { sourceId: 'fixture', record: Number(id.replace(/\D/g, '')) || 1 },
    tokens: { value: estimateTokens(text), method: 'calibrated-heuristic' },
    hash: contentHash(text),
    features: blockFeatures(text),
  };
}

function frame(seq, blocks, compactionRef) {
  return {
    seq,
    at: seq,
    model: { model: 'fixture' },
    blocks,
    usage: blocks.map((item) => ({ blockId: item.id, introducedSeq: 1, ageFrames: seq })),
    providerUsage: { inputAccounting: 'includes-cache', source: 'log' },
    totals: { input: blocks.reduce((sum, item) => sum + item.tokens.value, 0) },
    delta: { addedTokens: 0, carriedTokens: 0, addedBlockIds: [] },
    ...(compactionRef === undefined ? {} : { compactionRef }),
  };
}

test('compaction diff classifies kept, summarized, dropped, and added blocks', () => {
  const resident = block('b1', 'Base policy secureMode and localOnlyBoundary.', 'system');
  const request = block('b2', 'Inspect src/server/cache.ts and fix AnalysisCache eviction.', 'user');
  const result = block('b3', 'AnalysisCache has no maxEntries and retains buildReport results.', 'tool_result', 'read');
  const noise = block('b4', 'ok', 'assistant');
  const summary = block('a2', 'Fix AnalysisCache eviction in src/server/cache.ts with maxEntries before buildReport.', 'summary');
  const next = block('a3', 'Run the focused cache tests.', 'user');
  const before = frame(10, [resident, request, result, noise]);
  const after = frame(11, [resident, summary, next], 10);

  const fates = alignCompaction(before, after, { summaryCoverageThreshold: 0.1 });
  assert.ok(fates.some((fate) => fate.kind === 'kept' && fate.from === 'b1'));
  const summarized = fates.find((fate) => fate.kind === 'summarized');
  assert.ok(summarized);
  assert.deepEqual(new Set(summarized.from), new Set(['b2', 'b3']));
  assert.ok(summarized.coverage > 0);
  assert.ok(fates.some((fate) => fate.kind === 'dropped' && fate.from === 'b4'));
  assert.ok(fates.some((fate) => fate.kind === 'added' && fate.to === 'a3'));

  const event = buildCompactionEvent(before, after, { summaryCoverageThreshold: 0.1 });
  assert.equal(event.before, 10);
  assert.equal(event.after, 11);
  assert.ok(event.stats.compressionRatio < 1);
  assert.ok(event.stats.summarizedTokens > 0);
});

test('compaction diff recognizes a truncated block from shared chunks', () => {
  const shared = 'const cacheEntry = buildAnalysisReport(session); '.repeat(12);
  const beforeBlock = block('b1', `${shared}tail that is removed during compaction`.repeat(3), 'tool_result');
  const afterBlock = block('a1', shared, 'tool_result');
  const fates = alignCompaction(frame(1, [beforeBlock]), frame(2, [afterBlock], 1));
  assert.ok(fates.some((fate) => fate.kind === 'truncated'));
});

test('compaction diff does not call off-log content dropped when no summary is observed', () => {
  const beforeBlock = block('b1', 'Important user decision about src/index.ts and auditPolicy.', 'user');
  const fates = alignCompaction(frame(1, [beforeBlock]), frame(2, [], 1));
  assert.equal(fates[0]?.kind, 'unobserved');
  const event = buildCompactionEvent(frame(1, [beforeBlock]), frame(2, [], 1));
  assert.equal(event.stats.droppedTokens, 0);
  assert.equal(event.stats.unobservedTokens, beforeBlock.tokens.value);
});
