import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterNativeOutput,
  nativeGovernanceStrategies,
} from '../dist/index.js';

test('native JSON filter removes only whitespace outside strings and preserves large numeric lexemes', () => {
  const source = '{\n  "id": 900719925474099312345,\n  "note": "spaces stay here"\n}\n';
  const result = filterNativeOutput(source, { profile: 'json' });
  assert.equal(result.output, '{"id":900719925474099312345,"note":"spaces stay here"}');
  assert.equal(result.lossRisk, 'none');
  assert.equal(result.informationPolicy, 'lossless-normalization');
  assert.equal(result.estimate.billingEquivalent, false);
});

test('native generic filter removes terminal noise and folds consecutive repetitions', () => {
  const repeated = 'waiting for incremental build to finish before retrying';
  const source = `\u001b[32mready\u001b[0m\n${Array.from({ length: 10 }, () => repeated).join('\n')}\n`;
  const result = filterNativeOutput(source, { profile: 'generic', exitCode: 0 });
  assert.match(result.output, /^ready/);
  assert.match(result.output, /repeated previous line 9 more times/);
  assert.equal(result.exitCode, 0);
  assert.equal(result.lossRisk, 'low');
  assert.ok(result.compact.bytes < result.original.bytes);
});

test('native filter does not report lossy decisions when an oversized candidate falls back to source', () => {
  const source = Array.from({ length: 40 }, (_, index) => String.fromCharCode(33 + index)).join('\n');
  const result = filterNativeOutput(source, { profile: 'test' });
  assert.equal(result.output, source);
  assert.equal(result.lossRisk, 'none');
  assert.equal(result.informationPolicy, 'lossless-normalization');
  assert.equal(result.decisions.some((decision) => decision.id === 'omit-low-signal-lines'), false);
  assert.ok(result.warnings.includes('candidate-was-larger-than-original'));
});

test('native test filter retains failures and summaries while marking omitted low-signal lines', () => {
  const passing = Array.from({ length: 50 }, (_, index) => `PASS case ${index}`);
  const source = [
    'RUN test suite',
    ...passing,
    'FAIL parser preserves source refs',
    'Expected: exact source',
    'Received: missing source',
    'at parser.test.ts:42:7',
    'Tests: 1 failed, 50 passed, 51 total',
  ].join('\n');
  const result = filterNativeOutput(source, { profile: 'auto', command: 'pnpm test', exitCode: 1 });
  assert.equal(result.profile, 'test');
  assert.equal(result.lossRisk, 'medium');
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /FAIL parser preserves source refs/);
  assert.match(result.output, /Expected: exact source/);
  assert.match(result.output, /Tests: 1 failed, 50 passed/);
  assert.match(result.output, /tokray omitted/);
  assert.doesNotMatch(result.output, /PASS case 20/);
});

test('native generic truncation keeps diagnostic windows, head, and tail', () => {
  const lines = Array.from({ length: 320 }, (_, index) => `trace line ${index}`);
  lines[170] = 'fatal: database migration failed';
  const result = filterNativeOutput(lines.join('\n'), { profile: 'generic' });
  assert.match(result.output, /trace line 0/);
  assert.match(result.output, /fatal: database migration failed/);
  assert.match(result.output, /trace line 319/);
  assert.equal(result.lossRisk, 'medium');
});

test('native strategy registry separates shipped transforms from diagnosis and planned surfaces', () => {
  const strategies = nativeGovernanceStrategies();
  assert.equal(strategies.find((item) => item.id === 'request.govern')?.maturity, 'available');
  assert.equal(strategies.find((item) => item.id === 'output.filter')?.maturity, 'available');
  assert.equal(strategies.find((item) => item.id === 'context.deduplicate')?.maturity, 'diagnose');
  assert.equal(strategies.find((item) => item.id === 'context.progressive-disclosure')?.maturity, 'planned');
  assert.ok(strategies.every((item) => item.evidence.length > 0));
});
