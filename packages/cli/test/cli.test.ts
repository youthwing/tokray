import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '../dist/main.js');

async function fakeCodexAppServer(directory: string) {
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
    if (message.id !== 1) continue;
    const cwd = message.params.cwds[0];
    const path = join(cwd, '.codex', 'hooks.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    const handler = config.hooks.PostToolUse[0].hooks[0];
    process.stdout.write(JSON.stringify({ id: 1, result: { data: [{ cwd, hooks: [{
      key: path + ':post_tool_use:0:0', command: handler.command, sourcePath: path,
      enabled: true, currentHash: 'sha256:current', trustStatus: 'trusted'
    }], warnings: [], errors: [] }] } }) + '\\n');
  }
});
`);
  await chmod(executable, 0o755);
  return executable;
}

test('CLI parses a raw request without provider usage and labels totals estimated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokray-cli-'));
  try {
    const fixture = join(dir, 'request.jsonl');
    await writeFile(fixture, `${JSON.stringify({
      type: 'model_call',
      provider: 'openai',
      request: {
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello' }],
      },
    })}\n`);
    const result = spawnSync(process.execPath, [cli, fixture, '--no-color'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Tokray · raw-request/);
    assert.match(result.stdout, /raw-request · 1 frames · request-content estimates/);
    assert.match(result.stdout, /estimated from complete request content/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI native filter reads stdin and emits compact output without executing a command', () => {
  const source = Array.from({ length: 45 }, (_, index) => `worker output item ${index}: process completed a routine stage without additional detail`).join('\n')
    + '\nFAIL parser case\nExpected: source\nReceived: none\nTests: 1 failed, 44 passed\n';
  const result = spawnSync(process.execPath, [cli, 'filter', '--profile', 'test', '--command', 'pnpm test'], {
    encoding: 'utf8',
    input: source,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL parser case/);
  assert.match(result.stdout, /tokray omitted/);
  assert.doesNotMatch(result.stdout, /worker output item 20/);
});

test('CLI exposes the model gateway and requires a fixed upstream', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /tokray gateway --upstream <url>/);

  const env = { ...process.env };
  delete env['TOKRAY_GATEWAY_UPSTREAM'];
  const missingUpstream = spawnSync(process.execPath, [cli, 'gateway'], { encoding: 'utf8', env });
  assert.equal(missingUpstream.status, 2);
  assert.match(missingUpstream.stderr, /gateway --upstream <url>/);
});

test('CLI request governor emits a governed request without changing messages or parameters', () => {
  const request = {
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'Keep this message unchanged.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Please simply read a file in order to return its content.',
        parameters: { type: 'object', properties: { path: { type: 'string', default: './README.md' } } },
      },
    }],
  };
  const result = spawnSync(process.execPath, [cli, 'request', 'govern'], {
    encoding: 'utf8',
    input: JSON.stringify(request),
  });
  assert.equal(result.status, 0, result.stderr);
  const governed = JSON.parse(result.stdout);
  assert.deepEqual(governed.messages, request.messages);
  assert.deepEqual(governed.tools[0].function.parameters, request.tools[0].function.parameters);
  assert.ok(governed.tools[0].function.description.length < request.tools[0].function.description.length);
});

test('CLI request governor reports a governed candidate and exits nonzero when over budget', () => {
  const request = { model: 'gpt-5', input: 'x'.repeat(4_000), tools: [] };
  const result = spawnSync(process.execPath, [cli, 'request', 'govern', '--max-input-tokens', '8', '--report-json'], {
    encoding: 'utf8',
    input: JSON.stringify(request),
  });
  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout);
  assert.equal(report.budget.sendAllowed, false);
  assert.equal(report.request.input, request.input);
  assert.match(result.stderr, /request blocked/);
});

test('CLI Hook filter dispatches through a registered native Bridge and otherwise passes through', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokray-cli-hook-'));
  try {
    const configDir = join(dir, 'tokray');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'hook-bridges.json'), `${JSON.stringify({
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
    const source = Array.from({ length: 10 }, () => repeated).join('\n');
    const filtered = spawnSync(process.execPath, [cli, 'hook', 'filter', '--agent', 'codex', '--profile', 'generic'], {
      encoding: 'utf8',
      input: source,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.match(filtered.stdout, /repeated previous line 9 more times/);

    const codexHook = spawnSync(process.execPath, [cli, 'hook', 'filter', '--agent', 'codex', '--profile', 'generic'], {
      encoding: 'utf8',
      input: JSON.stringify({
        session_id: 'session-1',
        turn_id: 'turn-1',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        tool_input: { command: 'pnpm test' },
        tool_response: source,
      }),
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });
    assert.equal(codexHook.status, 0, codexHook.stderr);
    const codexHookOutput = JSON.parse(codexHook.stdout);
    assert.equal(codexHookOutput.continue, false);
    assert.match(codexHookOutput.stopReason, /repeated previous line 9 more times/);
    assert.match(codexHookOutput.stopReason, /waiting for incremental build/);

    const passthrough = spawnSync(process.execPath, [cli, 'hook', 'filter', '--agent', 'trae'], {
      encoding: 'utf8',
      input: source,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });
    assert.equal(passthrough.status, 0, passthrough.stderr);
    assert.equal(passthrough.stdout, source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI Codex Hook connector previews and applies only the approved Agent config hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tokray-cli-connect-'));
  try {
    const configDir = join(dir, 'tokray');
    const hooksPath = join(dir, '.codex', 'hooks.json');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'hook-bridges.json'), `${JSON.stringify({
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
    const env = { ...process.env, XDG_CONFIG_HOME: dir, XDG_STATE_HOME: dir };
    const previewResult = spawnSync(process.execPath, [
      cli, 'hook', 'connect', '--agent', 'codex', '--path', hooksPath,
    ], { encoding: 'utf8', env });
    assert.equal(previewResult.status, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.equal(preview.operation, 'create');
    assert.equal(preview.requiresCodexTrust, true);
    assert.equal(preview.dispatcherCommand, `${process.execPath} ${cli} hook filter --agent codex --profile auto`);

    const appliedResult = spawnSync(process.execPath, [
      cli, 'hook', 'connect', '--agent', 'codex', '--path', hooksPath,
      '--apply', '--expected-after-hash', preview.afterHash,
    ], { encoding: 'utf8', env });
    assert.equal(appliedResult.status, 0, appliedResult.stderr);
    const applied = JSON.parse(appliedResult.stdout);
    assert.equal(applied.receipt.action, 'connect-codex-post-tool-hook');
    const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
    assert.equal(hooks.hooks.PostToolUse[0].hooks[0].command, preview.dispatcherCommand);

    const codexExecutable = await fakeCodexAppServer(dir);
    const runtimeEnv = { ...env, TOKRAY_CODEX_EXECUTABLE: codexExecutable };
    const statusResult = spawnSync(process.execPath, [
      cli, 'hook', 'status', '--agent', 'codex', '--path', hooksPath,
    ], { encoding: 'utf8', env: runtimeEnv });
    assert.equal(statusResult.status, 0, statusResult.stderr);
    assert.equal(JSON.parse(statusResult.stdout).state, 'active');

    const selfTestResult = spawnSync(process.execPath, [
      cli, 'hook', 'self-test', '--agent', 'codex', '--path', hooksPath,
    ], { encoding: 'utf8', env: runtimeEnv });
    assert.equal(selfTestResult.status, 0, selfTestResult.stderr);
    const selfTest = JSON.parse(selfTestResult.stdout);
    assert.equal(selfTest.status, 'passed');
    assert.equal(selfTest.modelCalls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
