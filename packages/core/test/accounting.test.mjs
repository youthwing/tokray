import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationForSeq, segmentedCalibrationFor } from '../dist/accounting.js';

function frame(seq, model, estimate, truth, compactionRef) {
  return {
    seq,
    at: seq,
    model: { provider: 'fixture', model },
    blocks: [{ tokens: { value: estimate, method: 'calibrated-heuristic' } }],
    usage: [],
    providerUsage: { inputTokens: truth, inputAccounting: 'includes-cache', source: 'log' },
    totals: { input: truth },
    delta: { addedTokens: 0, carriedTokens: 0, addedBlockIds: [] },
    ...(compactionRef === undefined ? {} : { compactionRef }),
  };
}

test('segmented calibration splits on compaction and model changes', () => {
  const frames = [];
  for (let seq = 1; seq <= 4; seq++) frames.push(frame(seq, 'a', seq * 100, seq * 120 + 1_000));
  for (let seq = 5; seq <= 8; seq++) frames.push(frame(seq, 'a', seq * 100, seq * 80 + 4_000, seq === 5 ? 4 : undefined));
  for (let seq = 9; seq <= 12; seq++) frames.push(frame(seq, 'b', seq * 100, seq * 150 + 2_000));

  const segments = segmentedCalibrationFor(frames, 'usage-calibrated');
  assert.deepEqual(segments.map(({ fromSeq, toSeq, reason }) => ({ fromSeq, toSeq, reason })), [
    { fromSeq: 1, toSeq: 4, reason: 'session-start' },
    { fromSeq: 5, toSeq: 8, reason: 'compaction' },
    { fromSeq: 9, toSeq: 12, reason: 'model-change' },
  ]);
  assert.ok(Math.abs(calibrationForSeq(segments, 2).scale - 1.2) < 0.05);
  assert.ok(Math.abs(calibrationForSeq(segments, 6).scale - 0.8) < 0.05);
  assert.ok(Math.abs(calibrationForSeq(segments, 10).scale - 1.5) < 0.05);
});
