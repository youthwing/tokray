import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToolsReport, mcpServerOf, residentBreakdown } from '../dist/index.js';
import type {
  Attribution,
  BlockId,
  Calibration,
  ContentHash,
  ContextBlock,
  ContextFrame,
} from '../dist/index.js';

let n = 0;
const mkBlock = (kind: Attribution['kind'], source: string | undefined, tokens: number): ContextBlock => ({
  id: `b${++n}` as BlockId,
  attribution: { kind, confidence: 'exact', ...(source !== undefined ? { source } : {}) },
  sourceRef: { sourceId: 'f', record: n },
  tokens: { value: tokens, method: 'calibrated-heuristic' },
  hash: 'h' as ContentHash,
});

const mkFrame = (seq: number, blocks: ContextBlock[]): ContextFrame => ({
  seq,
  at: 0,
  model: { model: 'm' },
  blocks,
  usage: [],
  providerUsage: { inputTokens: 1000, inputAccounting: 'includes-cache', source: 'log' },
  totals: { input: 1000 },
  delta: { addedTokens: 0, carriedTokens: 0, addedBlockIds: [] },
});

test('buildToolsReport: aggregates per tool, dedupes blocks shared across frames', () => {
  const use1 = mkBlock('assistant', 'Bash', 20);
  const res1 = mkBlock('tool_result', 'Bash', 500);
  const prose = mkBlock('assistant', undefined, 50); // no source → not a tool_use
  const use2 = mkBlock('assistant', 'mcp__chrome__navigate', 10);
  const res2 = mkBlock('tool_result', 'mcp__chrome__navigate', 200);
  const orphan = mkBlock('tool_result', undefined, 77); // unmatched tool_result
  // Frames snapshot a shared timeline: frame 2 re-contains frame 1's blocks.
  const f1 = mkFrame(1, [use1, res1, prose]);
  const f2 = mkFrame(2, [use1, res1, prose, use2, res2, orphan]);

  const report = buildToolsReport([f1, f2], []);

  const bash = report.called.find((t) => t.name === 'Bash');
  assert.ok(bash);
  assert.equal(bash.calls, 1, 'shared block must count once, not per frame');
  assert.equal(bash.inputTokens, 20);
  assert.equal(bash.resultTokens, 500);
  assert.equal(bash.server, undefined);

  const nav = report.called.find((t) => t.name === 'mcp__chrome__navigate');
  assert.ok(nav);
  assert.equal(nav.server, 'chrome');

  const unmatched = report.called.find((t) => t.name === '(unmatched tool)');
  assert.ok(unmatched);
  assert.equal(unmatched.calls, 0);
  assert.equal(unmatched.resultTokens, 77);

  // Heaviest first.
  assert.equal(report.called[0]!.name, 'Bash');

  // Assistant prose must never appear as a tool.
  assert.ok(!report.called.some((t) => t.inputTokens === 50));
});

test('buildToolsReport: roster set arithmetic — deferred / loaded / never-called', () => {
  const useBash = mkBlock('assistant', 'Bash', 10);
  const useTaskGet = mkBlock('assistant', 'TaskGet', 10);
  const frame = mkFrame(1, [useBash, useTaskGet]);

  const report = buildToolsReport(
    [frame],
    [
      { atRecord: 1, deferredAdded: ['TaskGet', 'TaskList', 'WebFetch'] },
      { atRecord: 5, loaded: ['TaskGet', 'TaskList'] },
      { atRecord: 7, mcpServersAdded: ['chrome'] },
    ],
  );

  // TaskGet: deferred, loaded, called → fine. TaskList: loaded, never called → waste.
  assert.deepEqual(report.loadedNeverCalled, ['TaskList']);
  // WebFetch stayed deferred and uncalled → zero cost.
  assert.deepEqual(report.deferredNeverLoaded, ['WebFetch']);
  // Bash was called but never in the deferred roster → its schema was resident.
  assert.deepEqual(report.residentSuspects, ['Bash']);
  // Announced-but-idle server still shows up — that IS the finding.
  const chrome = report.mcpServers.find((m) => m.server === 'chrome');
  assert.ok(chrome);
  assert.equal(chrome.announced, true);
  assert.equal(chrome.calls, 0);
});

test('buildToolsReport: unmatched tool_results never become resident suspects', () => {
  const orphan = mkBlock('tool_result', undefined, 10);
  const report = buildToolsReport([mkFrame(1, [orphan])], []);
  assert.deepEqual(report.residentSuspects, []);
});

// A witnessed materialization is proof of NON-residency, even when the
// deferral announcement predates the log window (everDeferred is empty).
test('buildToolsReport: observed-loaded tools are never resident suspects', () => {
  const use = mkBlock('assistant', 'WebFetch', 10);
  const report = buildToolsReport([mkFrame(1, [use])], [{ atRecord: 3, loaded: ['WebFetch'] }]);
  assert.deepEqual(report.residentSuspects, []);
  assert.deepEqual(report.loaded, ['WebFetch']);
  // Called after load → not waste either.
  assert.deepEqual(report.loadedNeverCalled, []);
});

// The log can end mid-turn: epilogue blocks must count toward calls, or a
// tool loaded-then-called-at-the-end reads as loaded-but-never-called.
test('buildToolsReport: epilogue blocks count toward call stats', () => {
  const use = mkBlock('assistant', 'TaskGet', 10);
  const res = mkBlock('tool_result', 'TaskGet', 40);
  const report = buildToolsReport([], [{ atRecord: 1, loaded: ['TaskGet'] }], [use, res]);
  const stat = report.called.find((t) => t.name === 'TaskGet');
  assert.ok(stat);
  assert.equal(stat.calls, 1);
  assert.equal(stat.resultTokens, 40);
  assert.deepEqual(report.loadedNeverCalled, []);
});

test('mcpServerOf: convention parsing', () => {
  assert.equal(mcpServerOf('mcp__chrome__navigate'), 'chrome');
  assert.equal(mcpServerOf('mcp__a_b__c__d'), 'a_b'); // shortest server match
  assert.equal(mcpServerOf('Bash'), undefined);
  assert.equal(mcpServerOf('mcp____x'), undefined); // empty server name is not a server
});

const calWith = (value: number, band: readonly [number, number]): Calibration => ({
  scale: 1,
  resident: { value, method: 'calibrated-heuristic', errorBand: band },
  r2: 0.9,
  n: 10,
});

test('residentBreakdown: remainder math and band arithmetic', () => {
  const cal = calWith(10000, [8000, 12000]);
  const bd = residentBreakdown(cal, [
    { label: 'Bash', tokens: { value: 1200, method: 'prior', errorBand: [600, 3000] } },
    { label: 'Read', tokens: { value: 450, method: 'prior', errorBand: [225, 1125] } },
  ]);
  assert.equal(bd.unaccounted.value, 10000 - 1650);
  // Band: [totalLo − ΣcomponentHi, totalHi − ΣcomponentLo], clamped at 0.
  assert.deepEqual(bd.unaccounted.errorBand, [8000 - 4125, 12000 - 825]);
  assert.equal(bd.overshoot, false);
  // The measured total is never redistributed onto components.
  assert.equal(bd.components[0]!.tokens.value, 1200);
});

test('residentBreakdown: overshoot is flagged and clamped, never negative', () => {
  const cal = calWith(500, [0, 800]);
  const bd = residentBreakdown(cal, [
    { label: 'Workflow', tokens: { value: 2500, method: 'prior', errorBand: [1250, 6250] } },
  ]);
  assert.equal(bd.overshoot, true);
  assert.equal(bd.unaccounted.value, 0);
  assert.deepEqual(bd.unaccounted.errorBand, [0, 0]);
});

test('residentBreakdown: no components → everything is unaccounted', () => {
  const cal = calWith(9000, [7000, 11000]);
  const bd = residentBreakdown(cal, []);
  assert.equal(bd.unaccounted.value, 9000);
  assert.deepEqual(bd.unaccounted.errorBand, [7000, 11000]);
  assert.equal(bd.overshoot, false);
});
