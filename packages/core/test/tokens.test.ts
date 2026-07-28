import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFeatures, estimateTokens, contentHash } from '../dist/tokens.js';
import { calibrate, frameEstimates } from '../dist/calibrate.js';
import { normalizedInputTokens } from '../dist/accounting.js';

test('estimateTokens: empty and monotone', () => {
  assert.equal(estimateTokens(''), 0);
  const short = estimateTokens('hello world');
  const long = estimateTokens('hello world, this is a longer sentence with more words.');
  assert.ok(short > 0);
  assert.ok(long > short);
});

test('estimateTokens: CJK weighs heavier per char than ASCII', () => {
  const cjk = estimateTokens('这是一段中文文本内容');
  const ascii = estimateTokens('abcdefghij');
  assert.ok(cjk > ascii);
});

test('contentHash: deterministic, collision-resistant on simple cases', () => {
  assert.equal(contentHash('abc'), contentHash('abc'));
  assert.notEqual(contentHash('abc'), contentHash('abd'));
  assert.notEqual(contentHash('ab'), contentHash('ba'));
  assert.equal(contentHash('x').length, 16);
});

test('blockFeatures: keeps irreversible alignment evidence', () => {
  const features = blockFeatures('Inspect src/server/cache.ts and AnalysisCache before calling buildReport.');
  assert.ok(features.chunks.length > 0);
  assert.ok(features.idents.includes('src/server/cache.ts'));
  assert.ok(features.idents.includes('analysiscache'));
  assert.ok(!JSON.stringify(features).includes('Inspect'));
});

test('calibrate: recovers scale and resident on synthetic data', () => {
  // truth = 1.25 * estimate + 30000, with mild noise
  const points = Array.from({ length: 40 }, (_, i) => {
    const estimated = 1000 + i * 2500;
    const noise = (i % 5) * 40 - 80;
    return { seq: i + 1, estimated, truth: Math.round(1.25 * estimated + 30000 + noise) };
  });
  const c = calibrate(points);
  assert.ok(Math.abs(c.scale - 1.25) < 0.05, `scale=${c.scale}`);
  assert.ok(Math.abs(c.resident.value - 30000) < 1500, `resident=${c.resident.value}`);
  assert.ok(c.r2 > 0.99);
});

test('calibrate: degenerate input falls back honestly', () => {
  const flat = Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, estimated: 500, truth: 40000 }));
  const c = calibrate(flat);
  assert.equal(c.scale, 1);
  assert.equal(c.r2, 0);
  assert.ok((c.resident.errorBand?.[1] ?? 0) >= c.resident.value);
});

// Regression: r² is measured against the REPORTED model. When the clamp
// engages (true slope 10 >> max 3), a naive OLS r² reads ~1.0 — precisely
// when the numbers deserve the least confidence.
test('calibrate: r² drops when the scale clamp engages', () => {
  const points = [
    { seq: 1, estimated: 100, truth: 1000 },
    { seq: 2, estimated: 200, truth: 2000 },
    { seq: 3, estimated: 300, truth: 3000 },
  ];
  const c = calibrate(points);
  assert.equal(c.scale, 3);
  assert.ok(c.r2 < 0.7, `clamped fit must not claim high confidence, got r²=${c.r2}`);
});

// Regression: estimator overshoot must clamp to 0, never report negative
// tokens — in the degenerate branch AND within its own error band.
test('calibrate: resident is never negative and never a zero-width zero', () => {
  const overshoot = Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, estimated: 600, truth: 100 }));
  const d = calibrate(overshoot);
  assert.ok(d.resident.value >= 0);
  const band = d.resident.errorBand ?? [0, 0];
  assert.ok(band[0] <= d.resident.value && d.resident.value <= band[1]);

  const tiny = calibrate([{ seq: 1, estimated: 500, truth: 40000 }]);
  assert.ok(tiny.resident.value >= 0);
  assert.ok((tiny.resident.errorBand?.[1] ?? 0) > 0, 'n<3 must not claim exact-zero with a zero-width band');
});

// Regression: frames without usable usage (synthetic placeholders) must not
// reach the regression as (estimate>0, truth=0) poison points.
test('frameEstimates: excludes frames with no usable usage', () => {
  const mkFrame = (seq: number, input: number, est: number) => ({
    seq,
    at: 0,
    model: { model: 'm' },
    blocks: [{ tokens: { value: est, method: 'calibrated-heuristic' } }],
    usage: [],
    providerUsage: { inputTokens: input, inputAccounting: 'includes-cache', source: 'log' },
    totals: { input },
    delta: { addedTokens: 0, carriedTokens: 0, addedBlockIds: [] },
  });
  const pts = frameEstimates([mkFrame(1, 40000, 500), mkFrame(2, 0, 900), mkFrame(3, 41000, 700)]);
  assert.deepEqual(pts.map((p) => p.seq), [1, 3]);
});

// Regression: both hash lanes must depend on full code units — the old
// high-byte lane degenerated to a length counter on ASCII input.
test('contentHash: high lane differs for same-length ASCII strings', () => {
  const pairs: [string, string][] = [
    ['ab', 'cd'],
    ['hello', 'world'],
    ['const x = 1;', 'const y = 2;'],
  ];
  for (const [a, b] of pairs) {
    assert.notEqual(contentHash(a).slice(8), contentHash(b).slice(8), `${a} vs ${b}`);
  }
});

test('normalizedInputTokens: provider cache semantics are explicit', () => {
  assert.equal(normalizedInputTokens({ inputTokens: 1000, cacheReadTokens: 600, inputAccounting: 'includes-cache', source: 'api' }), 1000);
  assert.equal(normalizedInputTokens({ inputTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 50, inputAccounting: 'excludes-cache', source: 'api' }), 1050);
});
