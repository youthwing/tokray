import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapters, codexAdapter, detectAdapter, rawRequestAdapter } from '../dist/index.js';
import { AGENT_CAPABILITY_KEYS } from '@tokray/core';
import type { ContextFrame, ParseEvent } from '@tokray/core';

async function* bytes(records: unknown[]): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(records.map((record) => JSON.stringify(record)).join('\n'));
}

async function framesOf(events: AsyncIterable<ParseEvent>): Promise<ContextFrame[]> {
  const frames: ContextFrame[] = [];
  for await (const event of events) if (event.t === 'frame') frames.push(event.frame);
  return frames;
}

test('raw-request: OpenAI and Anthropic cache accounting normalize differently', async () => {
  const records = [
    {
      type: 'model_call',
      provider: 'openai',
      timestamp: '2026-07-27T00:00:00Z',
      request: {
        model: 'gpt-test',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
        ],
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      },
      response: {
        usage: { input_tokens: 1000, output_tokens: 20, input_tokens_details: { cached_tokens: 600 } },
      },
    },
    {
      type: 'model_call',
      provider: 'anthropic',
      request: {
        model: 'claude-test',
        system: 'system prompt',
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
        max_tokens: 100,
      },
      response: {
        usage: { input_tokens: 400, cache_read_input_tokens: 600, cache_creation_input_tokens: 50, output_tokens: 20 },
      },
    },
  ];
  const frames = await framesOf(rawRequestAdapter.parse(bytes(records), { sourceId: 'raw' }));
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.totals.input, 1000, 'OpenAI cached tokens are a subset of input_tokens');
  assert.equal(frames[1]!.totals.input, 1050, 'Anthropic cache tokens are additional to input_tokens');
  assert.deepEqual(frames[0]!.blocks.map((block) => block.attribution.kind), ['tool_schema', 'system', 'user']);
  assert.equal(frames[0]!.blocks[0]!.sourceRef.pointer, '/request/tools/0');
  assert.equal(frames[0]!.model.provider, 'openai');
});

test('codex: token_count frames snapshot context before the call output', async () => {
  const records = [
    { type: 'session_meta', timestamp: '2026-07-27T00:00:00Z', payload: { base_instructions: ['base'], dynamic_tools: [] } },
    { type: 'turn_context', timestamp: '2026-07-27T00:00:00Z', payload: { model: 'gpt-codex-test' } },
    { type: 'response_item', timestamp: '2026-07-27T00:00:01Z', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'dev' }] } },
    { type: 'response_item', timestamp: '2026-07-27T00:00:02Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'run it' }] } },
    { type: 'response_item', timestamp: '2026-07-27T00:00:03Z', payload: { type: 'function_call', name: 'exec', call_id: 'call-1', arguments: '{}' } },
    { type: 'response_item', timestamp: '2026-07-27T00:00:04Z', payload: { type: 'function_call_output', call_id: 'call-1', output: 'ok' } },
    { type: 'event_msg', timestamp: '2026-07-27T00:00:05Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5000, cached_input_tokens: 3000, output_tokens: 20 } } } },
    { type: 'response_item', timestamp: '2026-07-27T00:00:06Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } },
    { type: 'event_msg', timestamp: '2026-07-27T00:00:07Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5200, cached_input_tokens: 4000, output_tokens: 10 } } } },
  ];
  const frames = await framesOf(codexAdapter.parse(bytes(records), { sourceId: 'codex' }));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0]!.blocks.map((block) => block.attribution.kind), ['system', 'system', 'user']);
  assert.deepEqual(frames[1]!.blocks.map((block) => block.attribution.kind), ['system', 'system', 'user', 'assistant', 'tool_result']);
  assert.equal(frames[0]!.totals.input, 5000);
  assert.equal(frames[0]!.totals.cacheRead, 3000);
  assert.deepEqual(frames[0]!.model, { provider: 'openai', model: 'gpt-codex-test', agent: 'codex' });
  assert.ok(frames[1]!.usage.every((usage) => usage.ageFrames >= 1));
});

test('all built-in adapters declare a complete, explicit Agent capability matrix', () => {
  assert.equal(new Set(adapters.map((adapter) => adapter.id)).size, adapters.length, 'adapter ids must be unique');
  for (const adapter of adapters) {
    assert.deepEqual(Object.keys(adapter.agentCapabilities).sort(), [...AGENT_CAPABILITY_KEYS].sort());
    for (const support of Object.values(adapter.agentCapabilities)) {
      assert.ok(['full', 'partial', 'none', 'unknown'].includes(support));
    }
  }
  assert.equal(rawRequestAdapter.agentCapabilities.exactRequest, 'full');
  assert.equal(codexAdapter.agentCapabilities.compactionMarkers, 'full');
});

test('adapter detection distinguishes Claude, Codex, and raw requests', () => {
  const codex = [
    { type: 'session_meta', payload: {} },
    { type: 'turn_context', payload: { model: 'gpt' } },
  ].map(JSON.stringify).join('\n');
  const raw = JSON.stringify({ type: 'model_call', request: { model: 'gpt', messages: [] } });
  assert.equal(detectAdapter({ head: codex, name: 'rollout.jsonl' })?.id, 'codex');
  assert.equal(detectAdapter({ head: raw, name: 'requests.jsonl' })?.id, 'raw-request');
});
