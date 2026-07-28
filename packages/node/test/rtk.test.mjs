import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyHookBridge,
  dispatchHookFilter,
  dispatchHookRewrite,
  importRtkGain,
  inspectRtk,
  inspectRtkCommandSafety,
  listActionReceipts,
  previewHookBridge,
  previewRtkRewrite,
  rollbackHookBridge,
  runApprovedRtkComparison,
} from '../dist/index.js';

async function fakeRtk() {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-rtk-'));
  const executable = join(directory, 'rtk');
  await writeFile(executable, `#!/bin/sh
case "$1" in
  --version) printf 'rtk 0.40.0\\n' ;;
  gain) printf '%s\\n' '{"summary":{"total_commands":12,"total_input":1000,"total_output":240,"total_saved":760,"avg_savings_pct":76,"total_time_ms":120,"avg_time_ms":10},"daily":[{"date":"2026-07-27","commands":12,"input_tokens":1000,"output_tokens":240,"saved_tokens":760,"savings_pct":76,"total_time_ms":120,"avg_time_ms":10}],"weekly":[],"monthly":[]}' ;;
  rewrite)
    if [ "$2" = "git status" ]; then printf 'rtk git status\\n';
    elif [ "$2" = "ls" ]; then printf 'rtk ls\\n';
    else exit 1; fi ;;
  ls) printf '3 entries\\n' ;;
  git) printf 'compact git output\\n' ;;
  *) exit 2 ;;
esac
`, 'utf8');
  await chmod(executable, 0o755);
  return executable;
}

test('RTK provider detects the official binary and imports honest gain semantics', async () => {
  const executable = await fakeRtk();
  const status = await inspectRtk({ candidates: [executable] });
  assert.equal(status.availability, 'available');
  assert.equal(status.version, '0.40.0');

  const imported = await importRtkGain({ candidates: [executable] });
  assert.equal(imported.gain?.summary.totalCommands, 12);
  assert.equal(imported.gain?.summary.savedTokens, 760);
  assert.deepEqual(imported.gain?.estimate, {
    method: 'bytes/4',
    scope: 'bash-output',
    billingEquivalent: false,
  });
});

test('RTK rewrite preview never executes the command and reports unsupported input', async () => {
  const executable = await fakeRtk();
  const supported = await previewRtkRewrite('git status', { candidates: [executable] });
  assert.equal(supported.status, 'ready');
  assert.equal(supported.rewritten, 'rtk git status');
  assert.equal(supported.executesCommand, false);

  const unsupported = await previewRtkRewrite('echo hello', { candidates: [executable] });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.executesCommand, false);
});

test('RTK provider reports a missing binary without throwing', async () => {
  const status = await inspectRtk({ candidates: ['/definitely/not/rtk'] });
  assert.equal(status.availability, 'not-installed');
  const preview = await previewRtkRewrite('git status', { candidates: ['/definitely/not/rtk'] });
  assert.equal(preview.status, 'unavailable');
});

test('RTK comparison executes only allowlisted commands after explicit approval and writes a receipt', async () => {
  const executable = await fakeRtk();
  const directory = await mkdtemp(join(tmpdir(), 'tokray-compare-'));
  const receiptPath = join(directory, 'receipts.jsonl');
  await writeFile(join(directory, 'one.txt'), 'one');
  await writeFile(join(directory, 'two.txt'), 'two');
  const result = await runApprovedRtkComparison('ls', {
    approved: true,
    expectedRewrite: 'rtk ls',
  }, { candidates: [executable], cwd: directory, path: receiptPath });
  assert.equal(result.comparison.executedCommands, 2);
  assert.equal(result.comparison.original.exitCode, 0);
  assert.equal(result.comparison.compact.preview, '3 entries\n');
  assert.equal(result.comparison.estimate.billingEquivalent, false);
  assert.equal(result.receipt.action, 'compare-rtk-output');
  assert.equal(result.receipt.rollback.available, false);
  assert.equal((await listActionReceipts({ path: receiptPath }))[0]?.id, result.receipt.id);
});

test('RTK comparison allowlist rejects mutations and shell syntax', () => {
  assert.equal(inspectRtkCommandSafety('git status').allowed, true);
  assert.equal(inspectRtkCommandSafety('git branch -D main').allowed, false);
  assert.equal(inspectRtkCommandSafety('rm -rf .').allowed, false);
  assert.equal(inspectRtkCommandSafety('git status | cat').allowed, false);
});

test('Hook Bridge apply is Tokray-managed, receipt-backed, and reversible', async () => {
  const executable = await fakeRtk();
  const directory = await mkdtemp(join(tmpdir(), 'tokray-hook-'));
  const configPath = join(directory, 'hook-bridges.json');
  const receiptPath = join(directory, 'receipts.jsonl');
  const preview = await previewHookBridge('codebuddy', {
    provider: 'rtk',
    candidates: [executable],
    configPath,
    path: receiptPath,
    now: () => new Date('2026-07-27T08:00:00.000Z'),
  });
  assert.equal(preview.status, 'ready');
  assert.equal(preview.writesAgentConfig, false);
  assert.equal(preview.activation, 'registered-not-connected');
  const applied = await applyHookBridge('codebuddy', {
    approved: true,
    expectedAfterHash: preview.afterHash,
    registeredAt: preview.bridge.registeredAt,
  }, { provider: 'rtk', candidates: [executable], configPath, path: receiptPath });
  assert.equal(applied.receipt.rollback.available, true);
  assert.match(await readFile(configPath, 'utf8'), /rtk-shell-codebuddy/);
  const dispatched = await dispatchHookRewrite('codebuddy', 'git status', {
    candidates: [executable],
    configPath,
  });
  assert.equal(dispatched.status, 'rewritten');
  assert.equal(dispatched.rewritten, 'rtk git status');
  assert.equal(dispatched.executesCommand, false);
  const rollback = await rollbackHookBridge(applied.receipt.id, { approved: true }, {
    configPath,
    path: receiptPath,
  });
  assert.equal(rollback.status, 'rolled-back');
  const receipts = await listActionReceipts({ path: receiptPath });
  const original = receipts.find((receipt) => receipt.id === applied.receipt.id);
  assert.equal(original?.rollback.available, false);
  assert.equal(original?.rollback.rollbackReceiptId, rollback.id);
});

test('Hook Bridge rollback refuses to overwrite configuration changed after apply', async () => {
  const executable = await fakeRtk();
  const directory = await mkdtemp(join(tmpdir(), 'tokray-hook-conflict-'));
  const configPath = join(directory, 'hook-bridges.json');
  const receiptPath = join(directory, 'receipts.jsonl');
  const preview = await previewHookBridge('trae', { provider: 'rtk', candidates: [executable], configPath, path: receiptPath });
  const applied = await applyHookBridge('trae', {
    approved: true,
    expectedAfterHash: preview.afterHash,
    registeredAt: preview.bridge.registeredAt,
  }, { provider: 'rtk', candidates: [executable], configPath, path: receiptPath });
  await writeFile(configPath, '{"version":1,"bridges":[]}\n');
  await assert.rejects(
    rollbackHookBridge(applied.receipt.id, { approved: true }, { configPath, path: receiptPath }),
    /changed after apply/,
  );
});

test('Tokray Native Hook Bridge is built in, filters output, and remains reversible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-native-hook-'));
  const configPath = join(directory, 'hook-bridges.json');
  const receiptPath = join(directory, 'receipts.jsonl');
  const preview = await previewHookBridge('codex', {
    configPath,
    path: receiptPath,
    candidates: ['/definitely/not/rtk'],
    now: () => new Date('2026-07-28T08:00:00.000Z'),
  });
  assert.equal(preview.status, 'ready');
  assert.equal(preview.bridge.provider, 'tokray-native');
  assert.equal(preview.bridge.intercept, 'tool-output');
  assert.equal(preview.bridge.id, 'tokray-output-codex');

  const applied = await applyHookBridge('codex', {
    approved: true,
    expectedAfterHash: preview.afterHash,
    registeredAt: preview.bridge.registeredAt,
  }, { configPath, path: receiptPath });
  assert.match(await readFile(configPath, 'utf8'), /tokray-output-codex/);

  const repeated = 'waiting for incremental build to finish before retrying';
  const source = Array.from({ length: 12 }, () => repeated).join('\n');
  const dispatched = await dispatchHookFilter('codex', source, { profile: 'generic' }, { configPath });
  assert.equal(dispatched.status, 'filtered');
  assert.match(dispatched.output, /repeated previous line 11 more times/);
  assert.ok(dispatched.filter?.estimatedSavedTokens > 0);

  const rollback = await rollbackHookBridge(applied.receipt.id, { approved: true }, { configPath, path: receiptPath });
  assert.equal(rollback.status, 'rolled-back');
});

test('Tokray Native Hook filter fails open when output exceeds the transform limit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-native-hook-limit-'));
  const configPath = join(directory, 'hook-bridges.json');
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bridges: [{
      id: 'tokray-output-claude-code',
      agent: 'claude-code',
      enabled: true,
      provider: 'tokray-native',
      intercept: 'tool-output',
      activation: 'registered-not-connected',
      dispatcherCommand: 'tokray hook filter --agent claude-code --profile auto',
      registeredAt: '2026-07-28T08:00:00.000Z',
    }],
  })}\n`);
  const source = 'x'.repeat(1_000_001);
  const result = await dispatchHookFilter('claude-code', source, {}, { configPath });
  assert.equal(result.status, 'passthrough');
  assert.equal(result.output, source);
  assert.match(result.reason ?? '', /filter-error/);
});
