import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeSession } from '../dist/index.js';

test('usage summary excludes estimates and preserves cache accounting', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tokray-node-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'requests.jsonl');
  const records = [
    { provider: 'openai', model: 'gpt-test', messages: [{ role: 'user', content: 'estimated only' }] },
    {
      provider: 'anthropic',
      request: { model: 'claude-test', max_tokens: 64, messages: [{ role: 'user', content: 'measured' }] },
      response: { usage: { input_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 80 } },
    },
  ];
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  const file = await stat(path);
  const report = await analyzeSession({
    id: 'fixture',
    title: 'fixture',
    agent: 'raw-request',
    adapter: 'raw-request',
    location: path,
    modifiedAt: file.mtimeMs,
    bytes: file.size,
    path,
  });

  assert.equal(report.frames.length, 2);
  assert.equal(report.session.agent, 'raw-request');
  assert.equal(report.agentCapabilities.exactRequest, 'full');
  assert.deepEqual(report.usage.totals, {
    calls: 1,
    input: 1250,
    uncachedInput: 250,
    cacheRead: 1000,
    cacheWrite: 50,
    output: 80,
    reasoningOutput: 0,
  });
  assert.deepEqual(report.usage.sources, [{ source: 'api', calls: 1 }]);
  assert.equal(report.usage.byModel[0]?.model, 'claude-test');
});
