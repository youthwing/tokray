import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  agentSourceProfiles,
  expandConfiguredPath,
  loadTokrayConfiguration,
} from '../dist/index.js';

const capabilities = {
  accounting: 'exact-request',
  exactSystemPrompt: true,
  exactToolSchemas: false,
  exactUsage: true,
  compaction: 'none',
};

const agentCapabilities = {
  readLogs: 'full',
  exactUsage: 'full',
  exactRequest: 'full',
  compactionMarkers: 'none',
  preToolHook: 'none',
  rewriteOutput: 'none',
  toolAllowlist: 'none',
  modelRouting: 'none',
  compactionControl: 'none',
};

test('Tokray config expands custom paths and registers declarative adapters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tokray-config-'));
  const path = join(root, 'tokray.config.json');
  await writeFile(path, JSON.stringify({
    version: 1,
    sources: [{ path: '${TRACE_HOME}/sessions', agent: 'acme', adapter: 'acme' }],
    adapters: [{
      version: 1,
      id: 'acme',
      agent: 'acme',
      schemaRange: 'v1',
      format: 'jsonl',
      capabilities,
      agentCapabilities,
      detect: { all: [{ pointer: '/kind', equals: 'call' }] },
      frame: {
        model: { pointer: '/model' },
        messages: { pointer: '/messages' },
        usage: { inputTokens: '/usage/input', inputAccounting: 'includes-cache' },
      },
    }],
  }));
  const runtime = await loadTokrayConfiguration({
    configPaths: [path],
    cwd: root,
    home: root,
    env: { TRACE_HOME: join(root, 'traces') },
  });
  assert.deepEqual(runtime.issues, []);
  assert.equal(runtime.sources[0].path, join(root, 'traces', 'sessions'));
  assert.equal(runtime.adapters.at(-1).id, 'acme');
  assert.equal(runtime.adapterAgents.get('acme'), 'acme');
  assert.equal(runtime.adapters.at(-1).detect({ head: '{"kind":"call"}' }).match, true);
});

test('configuration errors are returned with structural paths instead of throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tokray-invalid-config-'));
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify({ version: 1, sources: [{}], adapters: [{ version: 1 }] }));
  const runtime = await loadTokrayConfiguration({ configPaths: [path], home: root, cwd: root, env: {} });
  assert.ok(runtime.issues.some((issue) => issue.path === '/sources/0/path'));
  assert.ok(runtime.issues.some((issue) => issue.path === '/adapters/0/id'));
  assert.equal(runtime.adapters.some((adapter) => adapter.id === undefined), false);
});

test('source profiles separate parsed, adapter-required, and opaque Agent stores', () => {
  const profiles = agentSourceProfiles({ home: '/home/tester', platform: 'linux', env: {} });
  assert.equal(profiles.find((profile) => profile.id === 'claude-code').access, 'parsed');
  assert.equal(profiles.find((profile) => profile.id === 'cline').access, 'adapter-required');
  assert.equal(profiles.find((profile) => profile.id === 'trae').access, 'opaque');
  assert.ok(profiles.find((profile) => profile.id === 'codebuddy').paths[0].includes('CodeBuddy'));
  assert.equal(expandConfiguredPath('~/logs', '/work', '/home/tester', {}), '/home/tester/logs');
});
