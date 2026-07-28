import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve(import.meta.dirname, '../dist/main.js');

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
