import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyHookBridge,
  applyCodexHookConnection,
  dispatchCodexPostToolUse,
  dispatchHookFilter,
  dispatchHookRewrite,
  importRtkGain,
  inspectCodexHookRuntime,
  inspectRtk,
  inspectRtkCommandSafety,
  listActionReceipts,
  previewHookBridge,
  previewCodexHookConnection,
  previewRtkRewrite,
  rollbackHookBridge,
  runApprovedRtkComparison,
  selfTestCodexHook,
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

async function fakeCodexAppServer() {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-codex-app-server-'));
  const executable = join(directory, 'codex');
  await writeFile(executable, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf('\\n');
    if (newline < 0) break;
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === 0) process.stdout.write(JSON.stringify({ id: 0, result: { codexHome: '/tmp/fake' } }) + '\\n');
    if (message.id !== 1) continue;
    const cwd = message.params.cwds[0];
    const path = join(cwd, '.codex', 'hooks.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    const handler = config.hooks.PostToolUse[0].hooks[0];
    process.stdout.write(JSON.stringify({ id: 1, result: { data: [{
      cwd,
      hooks: [{
        key: path + ':post_tool_use:0:0',
        eventName: 'postToolUse',
        handlerType: 'command',
        command: handler.command,
        sourcePath: path,
        enabled: process.env.FAKE_CODEX_HOOK_ENABLED !== 'false',
        currentHash: 'sha256:current',
        trustStatus: process.env.FAKE_CODEX_TRUST_STATUS || 'trusted'
      }],
      warnings: [],
      errors: []
    }] } }) + '\\n');
  }
});
`);
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

test('Hook Bridge preview updates a registered dispatcher when the executable command changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-hook-dispatcher-'));
  const configPath = join(directory, 'hook-bridges.json');
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bridges: [{
      id: 'tokray-output-codex',
      agent: 'codex',
      enabled: true,
      provider: 'tokray-native',
      intercept: 'tool-output',
      activation: 'registered-not-connected',
      dispatcherCommand: 'tokray hook filter --agent codex --profile auto',
      registeredAt: '2026-07-28T08:00:00.000Z',
    }],
  })}\n`);

  const dispatcherCommand = '/opt/node /workspace/tokray/dist/main.js hook filter --agent codex --profile auto';
  const preview = await previewHookBridge('codex', { configPath, dispatcherCommand });
  assert.equal(preview.status, 'ready');
  assert.equal(preview.operation, 'update');
  assert.equal(preview.bridge.dispatcherCommand, dispatcherCommand);
});

test('Codex PostToolUse adapter filters documented textual response shapes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-codex-hook-'));
  const configPath = join(directory, 'hook-bridges.json');
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bridges: [{
      id: 'tokray-output-codex',
      agent: 'codex',
      enabled: true,
      provider: 'tokray-native',
      intercept: 'tool-output',
      activation: 'registered-not-connected',
      dispatcherCommand: 'tokray hook filter --agent codex --profile auto',
      registeredAt: '2026-07-28T08:00:00.000Z',
    }],
  })}\n`);
  const repeated = 'waiting for incremental build to finish before retrying';
  const toolResponse = Array.from({ length: 10 }, () => repeated).join('\n');
  const result = await dispatchCodexPostToolUse({
    session_id: 'session-1',
    turn_id: 'turn-1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-1',
    tool_input: { command: 'pnpm test' },
    tool_response: toolResponse,
  }, { profile: 'generic' }, { configPath });

  assert.equal(result.status, 'filtered');
  assert.equal(result.hookOutput?.continue, false);
  assert.match(result.hookOutput?.stopReason ?? '', /repeated previous line 9 more times/);
  assert.equal(result.filter?.command, 'pnpm test');

  const structured = await dispatchCodexPostToolUse({
    hook_event_name: 'PostToolUse',
    tool_input: { cmd: 'pnpm test' },
    tool_response: {
      exit_code: 0,
      wall_time_seconds: 0.25,
      original_token_count: 1234,
      output: toolResponse,
    },
  }, { profile: 'generic' }, { configPath });
  assert.equal(structured.status, 'filtered');
  assert.match(structured.hookOutput?.stopReason ?? '', /exit_code=0/);
  assert.match(structured.hookOutput?.stopReason ?? '', /repeated previous line 9 more times/);
  assert.equal(structured.filter?.command, 'pnpm test');

  const contentBlocks = await dispatchCodexPostToolUse({
    hook_event_name: 'PostToolUse',
    tool_response: { content: [{ type: 'input_text', text: toolResponse }] },
  }, { profile: 'generic' }, { configPath });
  assert.equal(contentBlocks.status, 'filtered');
  assert.match(contentBlocks.hookOutput?.stopReason ?? '', /repeated previous line 9 more times/);

  const unsupported = await dispatchCodexPostToolUse({
    hook_event_name: 'PostToolUse',
    tool_response: { content: [{ type: 'image', data: 'base64-data' }] },
  }, { profile: 'generic' }, { configPath });
  assert.deepEqual(unsupported, { status: 'passthrough', reason: 'unsupported-codex-tool-response' });

  const unregistered = await dispatchCodexPostToolUse({
    hook_event_name: 'PostToolUse',
    tool_input: { command: 'pnpm test' },
    tool_response: toolResponse,
  }, { profile: 'generic' }, { configPath: join(directory, 'missing.json') });
  assert.deepEqual(unregistered, { status: 'passthrough', reason: 'bridge-not-registered' });
});

test('Codex Hook connection merges existing Agent config with approval, receipt, and guarded rollback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-codex-connect-'));
  const configPath = join(directory, 'hook-bridges.json');
  const codexHooksPath = join(directory, '.codex', 'hooks.json');
  const receiptPath = join(directory, 'receipts.jsonl');
  await mkdir(join(directory, '.codex'), { recursive: true });
  await writeFile(codexHooksPath, `${JSON.stringify({
    description: 'Keep this metadata',
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo existing' }] }],
    },
  }, null, 2)}\n`);

  const bridgePreview = await previewHookBridge('codex', { configPath, path: receiptPath });
  await applyHookBridge('codex', {
    approved: true,
    expectedAfterHash: bridgePreview.afterHash,
    registeredAt: bridgePreview.bridge.registeredAt,
  }, { configPath, path: receiptPath });

  const preview = await previewCodexHookConnection({ configPath, codexHooksPath, path: receiptPath });
  assert.equal(preview.status, 'ready');
  assert.equal(preview.operation, 'update');
  assert.equal(preview.writesAgentConfig, true);
  assert.equal(preview.requiresCodexTrust, true);

  const applied = await applyCodexHookConnection({
    approved: true,
    expectedAfterHash: preview.afterHash,
  }, { configPath, codexHooksPath, path: receiptPath });
  const connected = JSON.parse(await readFile(codexHooksPath, 'utf8'));
  assert.equal(connected.description, 'Keep this metadata');
  assert.equal(connected.hooks.SessionStart[0].hooks[0].command, 'echo existing');
  assert.equal(connected.hooks.PostToolUse[0].matcher, '*');
  assert.equal(
    connected.hooks.PostToolUse[0].hooks[0].command,
    'tokray hook filter --agent codex --profile auto',
  );
  assert.equal(applied.receipt.action, 'connect-codex-post-tool-hook');
  assert.equal(applied.receipt.result?.requiresCodexTrust, true);

  const rollback = await rollbackHookBridge(applied.receipt.id, { approved: true }, {
    configPath,
    codexHooksPath,
    path: receiptPath,
  });
  assert.equal(rollback.status, 'rolled-back');
  const restored = JSON.parse(await readFile(codexHooksPath, 'utf8'));
  assert.equal(restored.description, 'Keep this metadata');
  assert.equal(restored.hooks.PostToolUse, undefined);
});

test('Codex Hook connection replaces stale Tokray handlers once and then remains byte-stable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-codex-idempotent-'));
  const configPath = join(directory, 'hook-bridges.json');
  const codexHooksPath = join(directory, '.codex', 'hooks.json');
  const receiptPath = join(directory, 'receipts.jsonl');
  const dispatcherCommand = '/opt/node /workspace/tokray.js hook filter --agent codex --profile auto';
  await mkdir(join(directory, '.codex'), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bridges: [{
      id: 'tokray-output-codex', agent: 'codex', enabled: true, provider: 'tokray-native',
      intercept: 'tool-output', activation: 'registered-not-connected', dispatcherCommand,
      registeredAt: '2026-07-28T08:00:00.000Z',
    }],
  })}\n`);
  await writeFile(codexHooksPath, `${JSON.stringify({
    hooks: {
      PostToolUse: [
        { matcher: 'Bash', hooks: [
          { type: 'command', command: 'echo user-hook' },
          { type: 'command', command: 'old-tokray hook filter --agent codex', statusMessage: 'Filtering tool output with Tokray' },
        ] },
        { matcher: '*', hooks: [
          { type: 'command', command: 'duplicate-tokray hook filter --agent codex', statusMessage: 'Filtering tool output with Tokray' },
        ] },
      ],
    },
  }, null, 2)}\n`);

  const preview = await previewCodexHookConnection({ configPath, codexHooksPath, path: receiptPath, dispatcherCommand });
  assert.equal(preview.operation, 'update');
  await applyCodexHookConnection({ approved: true, expectedAfterHash: preview.afterHash }, {
    configPath, codexHooksPath, path: receiptPath, dispatcherCommand,
  });
  const content = await readFile(codexHooksPath, 'utf8');
  const connected = JSON.parse(content);
  const handlers = connected.hooks.PostToolUse.flatMap((group) => group.hooks);
  assert.equal(handlers.filter((handler) => handler.statusMessage === 'Filtering tool output with Tokray').length, 1);
  assert.equal(handlers.filter((handler) => handler.command === 'echo user-hook').length, 1);
  assert.equal(handlers.find((handler) => handler.statusMessage === 'Filtering tool output with Tokray').command, dispatcherCommand);

  const repeated = await previewCodexHookConnection({ configPath, codexHooksPath, path: receiptPath, dispatcherCommand });
  assert.equal(repeated.operation, 'unchanged');
  assert.equal(await readFile(codexHooksPath, 'utf8'), content);
});

test('Codex Hook runtime maps official trust states and runs a zero-model local self-test', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokray-codex-runtime-'));
  const configPath = join(directory, 'hook-bridges.json');
  const codexHooksPath = join(directory, '.codex', 'hooks.json');
  const dispatcherCommand = 'tokray hook filter --agent codex --profile auto';
  const codexExecutable = await fakeCodexAppServer();
  await mkdir(join(directory, '.codex'), { recursive: true });
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    bridges: [{
      id: 'tokray-output-codex', agent: 'codex', enabled: true, provider: 'tokray-native',
      intercept: 'tool-output', activation: 'registered-not-connected', dispatcherCommand,
      registeredAt: '2026-07-28T08:00:00.000Z',
    }],
  })}\n`);
  await writeFile(codexHooksPath, `${JSON.stringify({ hooks: { PostToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'command', command: dispatcherCommand, timeout: 30,
      statusMessage: 'Filtering tool output with Tokray',
    }],
  }] } }, null, 2)}\n`);
  const options = { cwd: directory, configPath, codexHooksPath, dispatcherCommand, codexExecutable };

  const active = await inspectCodexHookRuntime(options);
  assert.equal(active.state, 'active');
  assert.equal(active.trustStatus, 'trusted');

  const pending = await inspectCodexHookRuntime({ ...options, env: { FAKE_CODEX_TRUST_STATUS: 'untrusted' } });
  assert.equal(pending.state, 'pending-trust');

  const invalid = await inspectCodexHookRuntime({ ...options, env: { FAKE_CODEX_TRUST_STATUS: 'modified' } });
  assert.equal(invalid.state, 'invalid');

  const selfTest = await selfTestCodexHook(options);
  assert.equal(selfTest.status, 'passed');
  assert.equal(selfTest.modelCalls, 0);
  assert.equal(selfTest.checks.markersPreserved, true);
  assert.ok(selfTest.outputBytes < selfTest.inputBytes);
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
