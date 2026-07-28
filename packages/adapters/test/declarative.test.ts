import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeclarativeAdapter, validateDeclarativeAdapterDefinition, valueAtPointer } from '../dist/index.js';
import type { DeclarativeAdapterDefinition } from '../dist/index.js';
import type { ContextFrame, ParseEvent } from '@tokray/core';

const definition: DeclarativeAdapterDefinition = {
  version: 1,
  id: 'acme-agent',
  agent: 'acme-agent',
  schemaRange: 'acme trace v1',
  format: 'jsonl',
  capabilities: {
    accounting: 'exact-request',
    exactSystemPrompt: true,
    exactToolSchemas: true,
    exactUsage: true,
    compaction: 'none',
  },
  agentCapabilities: {
    readLogs: 'full',
    exactUsage: 'full',
    exactRequest: 'full',
    compactionMarkers: 'none',
    preToolHook: 'none',
    rewriteOutput: 'none',
    toolAllowlist: 'none',
    modelRouting: 'none',
    compactionControl: 'none',
  },
  detect: { all: [{ pointer: '/kind', equals: 'llm.call' }] },
  frame: {
    when: { pointer: '/kind', equals: 'llm.call' },
    timestamp: { pointer: '/time', unit: 'iso' },
    model: { pointer: '/request/model' },
    provider: { pointer: '/provider', fallback: 'unknown' },
    system: { pointer: '/request/system' },
    messages: { pointer: '/request/chat', rolePointer: '/speaker', contentPointer: '/body' },
    tools: { pointer: '/request/functions', namePointer: '/function/name' },
    usage: {
      inputTokens: '/metrics/prompt',
      outputTokens: '/metrics/completion',
      cacheReadTokens: '/metrics/cached',
      inputAccounting: 'includes-cache',
      source: 'log',
    },
  },
};

async function* bytes(records: unknown[]): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join('\n'));
}

test('declarative adapter maps custom JSONL records to a standard frame', async () => {
  const adapter = createDeclarativeAdapter(definition);
  const record = {
    kind: 'llm.call',
    time: '2026-07-27T10:00:00Z',
    provider: 'deepseek',
    request: {
      model: 'deepseek-v3',
      system: 'be concise',
      chat: [
        { speaker: 'user', body: 'hello' },
        { speaker: 'assistant', body: 'hi' },
      ],
      functions: [{ function: { name: 'search' }, schema: { type: 'object' } }],
    },
    metrics: { prompt: 900, cached: 600, completion: 20 },
  };
  assert.equal(adapter.detect({ head: JSON.stringify(record), name: 'trace.ndjson' }).match, true);
  const frames: ContextFrame[] = [];
  for await (const event of adapter.parse(bytes([record]), { sourceId: 'fixture' })) {
    if ((event as ParseEvent).t === 'frame') frames.push((event as Extract<ParseEvent, { t: 'frame' }>).frame);
  }
  assert.equal(frames.length, 1);
  const frame = frames[0]!;
  assert.deepEqual(frame.model, { agent: 'acme-agent', provider: 'deepseek', model: 'deepseek-v3' });
  assert.deepEqual(frame.blocks.map((block) => block.attribution.kind), ['system', 'tool_schema', 'user', 'assistant']);
  assert.equal(frame.blocks[1]!.sourceRef.pointer, '/request/functions/0');
  assert.equal(frame.totals.input, 900);
  assert.equal(frame.totals.cacheRead, 600);
  assert.equal(frame.totals.output, 20);
});

test('declarative definition validation is explicit and JSON pointer decoding is RFC 6901 compatible', () => {
  assert.deepEqual(valueAtPointer({ 'a/b': { '~key': 7 } }, '/a~1b/~0key'), 7);
  const issues = validateDeclarativeAdapterDefinition({ version: 1, id: '', format: 'jsonl' });
  assert.ok(issues.some((issue) => issue.path === '/id'));
  assert.ok(issues.some((issue) => issue.path === '/frame/model/pointer'));
  assert.ok(issues.some((issue) => issue.path === '/agentCapabilities/readLogs'));
});
