import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeCodeAdapter, schemaPrior } from '../dist/index.js';
import type { Anomaly, ContextFrame, ParseEvent, ToolRosterDelta } from '@tokray/core';

/**
 * Synthetic session exercising every record shape the adapter claims to
 * understand, plus the degradation paths. Golden expectations below are the
 * adapter's conformance contract: a schema drift that silently changes any of
 * them must fail here, not in production.
 */
const LINES = [
  // Session metadata that must be silently ignored (known list).
  { type: 'mode', mode: 'default', sessionId: 's1' },
  { type: 'custom-title', customTitle: 'x', sessionId: 's1' },
  // Turn 1: plain-string user message.
  { type: 'user', message: { role: 'user', content: 'hello agent' }, sessionId: 's1', timestamp: '2026-07-27T10:00:00Z' },
  // Injected system content.
  { type: 'attachment', attachment: { type: 'skills', content: 'skill listing here' }, sessionId: 's1' },
  // One API call logged as two records sharing a requestId (block-per-record).
  {
    type: 'assistant',
    requestId: 'req_1',
    timestamp: '2026-07-27T10:00:01Z',
    message: {
      model: 'claude-test-1',
      content: [{ type: 'thinking', thinking: 'private reasoning that must not be counted' }],
      usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 30000, output_tokens: 5 },
    },
  },
  {
    type: 'assistant',
    requestId: 'req_1',
    timestamp: '2026-07-27T10:00:02Z',
    message: {
      model: 'claude-test-1',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__browser__screenshot', input: { url: 'x' } }],
      usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 30000, output_tokens: 25 },
    },
  },
  // Tool result with one text part and one image part (flat-priced).
  {
    type: 'user',
    sessionId: 's1',
    timestamp: '2026-07-27T10:00:03Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: [
            { type: 'text', text: 'took a screenshot' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(50000) } },
          ],
        },
      ],
    },
  },
  // Second call: server-tool-use style usage with 2 iterations; last one wins.
  {
    type: 'assistant',
    requestId: 'req_2',
    timestamp: '2026-07-27T10:00:04Z',
    message: {
      model: 'claude-test-1',
      content: [{ type: 'text', text: 'done!' }],
      usage: {
        input_tokens: 99999,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 12,
        iterations: [
          { input_tokens: 100, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0, output_tokens: 4 },
          { input_tokens: 50, cache_read_input_tokens: 31000, cache_creation_input_tokens: 500, output_tokens: 8 },
        ],
      },
    },
  },
  // Degradation paths: unknown record type → anomaly; broken JSON → anomaly.
  { type: 'totally-new-record-kind', sessionId: 's1' },
];

async function* byteStream(lines: unknown[], extraRaw?: string): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n' + (extraRaw ?? '');
  // Deliberately tiny chunks so line- and char-boundary handling is exercised.
  for (let i = 0; i < text.length; i += 7) yield enc.encode(text.slice(i, i + 7));
}

async function collect(events: AsyncIterable<ParseEvent>) {
  const frames: ContextFrame[] = [];
  const anomalies: Anomaly[] = [];
  const rosters: ToolRosterDelta[] = [];
  for await (const ev of events) {
    if (ev.t === 'frame') frames.push(ev.frame);
    if (ev.t === 'anomaly') anomalies.push(ev.anomaly);
    if (ev.t === 'roster') rosters.push(ev.delta);
  }
  return { frames, anomalies, rosters };
}

test('claude-code adapter: frames, attribution, and degradation paths', async () => {
  const { frames, anomalies } = await collect(
    claudeCodeAdapter.parse(byteStream(LINES, '{broken json\n'), { sourceId: 'fixture' }),
  );

  // Two API calls → two frames, grouped by requestId, not by record.
  assert.equal(frames.length, 2);
  const [f1, f2] = frames as [ContextFrame, ContextFrame];

  // Frame 1: exact totals from usage; blocks = user text + attachment.
  assert.equal(f1.totals.input, 30010);
  assert.deepEqual(f1.model, { provider: 'anthropic', model: 'claude-test-1', agent: 'claude-code' });
  assert.deepEqual(
    f1.blocks.map((b) => b.attribution.kind),
    ['user', 'system'],
  );

  // Frame 2 usage comes from the LAST iteration, not the aggregate.
  assert.equal(f2.totals.input, 50 + 31000 + 500);
  assert.equal(f2.totals.output, 8);

  // Frame 2 context gained: assistant tool_use + the tool_result. Thinking is excluded.
  const kinds2 = f2.blocks.map((b) => b.attribution.kind);
  assert.deepEqual(kinds2, ['user', 'system', 'assistant', 'tool_result']);

  // The image inside the tool_result is flat-priced, never length-priced:
  // 50k base64 chars would estimate >13k tokens; the flat price is ~1.1k.
  const toolResult = f2.blocks.find((b) => b.attribution.kind === 'tool_result');
  assert.ok(toolResult);
  assert.ok(toolResult.tokens.value < 1300, `image over-priced: ${toolResult.tokens.value}`);
  assert.equal(toolResult.attribution.source, 'mcp__browser__screenshot');

  // Degradations surface as anomalies with redacted samples, never throws.
  assert.equal(anomalies.length, 2);
  const codes = anomalies.map((a) => a.code).sort();
  assert.deepEqual(codes, ['unknown-record-type', 'unparseable']);
  for (const a of anomalies) {
    assert.ok(!a.redactedSample.includes('AAAA'), 'redaction must strip content');
  }
});

test('claude-code adapter: detect accepts real-shaped logs, rejects noise', () => {
  const good = LINES.map((l) => JSON.stringify(l)).join('\n');
  assert.equal(claudeCodeAdapter.detect({ head: good, name: 'x.jsonl' }).match, true);
  assert.equal(claudeCodeAdapter.detect({ head: 'not json\nat all\n', name: 'x.txt' }).match, false);
  assert.equal(claudeCodeAdapter.detect({ head: '', name: 'empty.jsonl' }).match, false);
});

const usage = (input: number, cr = 0, cw = 0, out = 1) => ({
  input_tokens: input,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cw,
  output_tokens: out,
});

const assistantRec = (requestId: string, content: unknown[], u: unknown = usage(10, 30000)) => ({
  type: 'assistant',
  requestId,
  timestamp: '2026-07-27T10:00:00Z',
  message: { model: 'claude-test-1', content, usage: u },
});

const userText = (text: string) => ({
  type: 'user',
  message: { role: 'user', content: text },
});

// Regression: parallel tool execution interleaves tool_results INTO an
// assistant run. One requestId = one API call = one frame, even when its
// records are separated by user records. (Real sessions: 445 records,
// 188 distinct requestIds, adjacent-merge recovers exactly 188.)
test('claude-code adapter: interleaved tool_results do not split a request into duplicate frames', async () => {
  const lines = [
    userText('go'),
    assistantRec('req_1', [{ type: 'tool_use', id: 't1', name: 'ToolA', input: {} }]),
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result A' }] },
    },
    assistantRec('req_1', [{ type: 'tool_use', id: 't2', name: 'ToolB', input: {} }]),
    assistantRec('req_2', [{ type: 'text', text: 'done' }], usage(10, 31000)),
  ];
  const { frames, anomalies } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(anomalies.length, 0);
  assert.equal(frames.length, 2, 'req_1 must be ONE frame despite the interleaved tool_result');
  // The interleaved tool_result was not part of req_1's prompt…
  assert.ok(!frames[0]!.blocks.some((b) => b.attribution.kind === 'tool_result'));
  // …but IS part of req_2's.
  assert.ok(frames[1]!.blocks.some((b) => b.attribution.kind === 'tool_result'));
});

// Regression: synthetic placeholders ("Credit balance is too low") are not
// model calls — no frame, no timeline pollution, loud anomaly.
test('claude-code adapter: synthetic records are skipped, not framed as 0-token calls', async () => {
  const lines = [
    userText('hi'),
    {
      type: 'assistant',
      requestId: 'req_err',
      isApiErrorMessage: true,
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Credit balance is too low' }], usage: usage(0, 0, 0, 0) },
    },
    assistantRec('req_1', [{ type: 'text', text: 'ok' }]),
  ];
  const { frames, anomalies } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(frames.length, 1);
  assert.ok(frames.every((f) => f.totals.input > 0));
  assert.ok(!frames[0]!.blocks.some((b) => b.hash === undefined || /Credit balance/.test('')), 'sanity');
  // The synthetic text must not have entered the timeline as assistant output.
  assert.ok(!frames[0]!.blocks.some((b) => b.attribution.kind === 'assistant'));
  assert.equal(anomalies.filter((a) => a.code === 'missing-field').length, 1);
});

// Regression: user-pasted images are flat-priced like tool images — a 200k
// base64 screenshot must never contribute ~50k phantom tokens.
test('claude-code adapter: user-pasted images are flat-priced', async () => {
  const lines = [
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'B'.repeat(200000) } },
          { type: 'text', text: 'what is this?' },
        ],
      },
    },
    assistantRec('req_1', [{ type: 'text', text: 'a chart' }]),
  ];
  const { frames } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  const image = frames[0]!.blocks.find((b) => b.attribution.evidence?.includes('image'));
  assert.ok(image);
  assert.ok(image.tokens.value <= 1200, `pasted image over-priced: ${image.tokens.value}`);
  assert.equal(image.attribution.confidence, 'guessed');
});

// Regression: null / non-object content parts degrade to anomalies — the
// Adapter contract says "never throws".
test('claude-code adapter: null content parts degrade, never crash', async () => {
  const lines = [
    { type: 'user', message: { role: 'user', content: [null, { type: 'text', text: 'hi' }, 42] } },
    assistantRec('req_1', [null, { type: 'text', text: 'ok' }]),
  ];
  const { frames, anomalies } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(frames.length, 1);
  assert.equal(anomalies.filter((a) => a.code === 'schema-version-drift').length, 3);
});

// Regression: compaction resets the carried-prefix bookkeeping — the first
// post-compaction frame's blocks are all NEW, not "carried".
test('claude-code adapter: post-compaction delta counts summary blocks as added', async () => {
  const lines = [
    userText('turn 1'),
    assistantRec('req_1', [{ type: 'text', text: 'reply 1' }]),
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary of everything so far' } },
    assistantRec('req_2', [{ type: 'text', text: 'reply 2' }], usage(10, 5000)),
  ];
  const { frames } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(frames.length, 2);
  const post = frames[1]!;
  assert.equal(post.compactionRef, 1);
  assert.equal(post.blocks.length, 1);
  assert.equal(post.blocks[0]!.attribution.kind, 'summary');
  assert.equal(post.delta.carriedTokens, 0, 'nothing survives a timeline reset');
  assert.ok(post.delta.addedTokens > 0);
  assert.deepEqual(post.delta.addedBlockIds, [post.blocks[0]!.id]);
});

// W2: the deferred-tool roster, MCP announcements, and ToolSearch schema
// materializations are surfaced as roster events; delta-style attachments
// contribute their text (names/lines/blocks) to the timeline instead of
// being silently dropped.
test('claude-code adapter: roster events from attachments and tool_reference results', async () => {
  const lines = [
    {
      type: 'attachment',
      attachment: { type: 'deferred_tools_delta', addedNames: ['TaskGet', 'TaskList', 'WebFetch'] },
    },
    {
      type: 'attachment',
      attachment: {
        type: 'mcp_instructions_delta',
        addedNames: ['chrome'],
        addedBlocks: ['## chrome\nAlways batch ToolSearch loads into one call.'],
        removedNames: [],
      },
    },
    {
      type: 'attachment',
      attachment: { type: 'agent_listing_delta', addedTypes: ['Explore'], addedLines: ['- Explore: read-only search agent'] },
    },
    userText('load the task tools'),
    assistantRec('req_1', [{ type: 'tool_use', id: 'ts1', name: 'ToolSearch', input: { query: 'select:TaskGet,TaskList' } }]),
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'ts1',
            content: [
              { type: 'tool_reference', tool_name: 'TaskGet' },
              { type: 'tool_reference', tool_name: 'TaskList' },
            ],
          },
        ],
      },
    },
    assistantRec('req_2', [{ type: 'text', text: 'loaded' }], usage(10, 31000)),
  ];
  const { frames, anomalies, rosters } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(anomalies.length, 0);

  assert.deepEqual(
    rosters.map((r) => ({ ...r, atRecord: 0 })),
    [
      { atRecord: 0, deferredAdded: ['TaskGet', 'TaskList', 'WebFetch'] },
      { atRecord: 0, mcpServersAdded: ['chrome'] },
      { atRecord: 0, loaded: ['TaskGet', 'TaskList'] },
    ],
  );

  // Delta attachments reach the model as reminders → they must carry tokens.
  const f1 = frames[0]!;
  const systemBlocks = f1.blocks.filter((b) => b.attribution.kind === 'system');
  assert.equal(systemBlocks.length, 3);
  assert.ok(systemBlocks.every((b) => b.tokens.value > 0));
  const mcpBlock = systemBlocks.find((b) => b.attribution.source === 'attachment:mcp_instructions_delta');
  assert.ok(mcpBlock);
  assert.ok(mcpBlock.tokens.value >= 10, 'instruction text must be estimated from addedBlocks');

  // Each materialization becomes its own tool_schema block, method 'prior'
  // with a band — prior tokens are never laundered into an estimator block.
  const f2 = frames[1]!;
  const schemas = f2.blocks.filter((b) => b.attribution.kind === 'tool_schema');
  assert.deepEqual(
    schemas.map((b) => b.attribution.source),
    ['TaskGet', 'TaskList'],
  );
  for (const b of schemas) {
    assert.equal(b.tokens.method, 'prior');
    assert.ok(b.tokens.errorBand, 'priors must carry a band');
    assert.equal(b.tokens.value, schemaPrior(b.attribution.source!).value);
    assert.equal(b.attribution.confidence, 'inferred');
  }
  // A pure-reference result has no text of its own: no empty tool_result block.
  assert.ok(!f2.blocks.some((b) => b.attribution.kind === 'tool_result'));
});

// W2: the log ending mid-turn must not hide the final run's tool activity —
// blocks past the last frame snapshot surface as one epilogue event.
test('claude-code adapter: epilogue carries blocks no frame ever saw', async () => {
  const lines = [
    userText('go'),
    assistantRec('req_1', [{ type: 'tool_use', id: 't1', name: 'TaskGet', input: {} }]),
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'the task' }] },
    },
    // Log ends here: no second request, so nothing snapshots these blocks.
  ];
  const events: ParseEvent[] = [];
  for await (const ev of claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' })) events.push(ev);
  const frames = events.filter((e) => e.t === 'frame');
  const epilogues = events.filter((e) => e.t === 'epilogue');
  assert.equal(frames.length, 1);
  assert.equal(epilogues.length, 1);
  const blocks = (epilogues[0] as Extract<ParseEvent, { t: 'epilogue' }>).blocks;
  // The final run's tool_use and its result live only in the epilogue.
  assert.deepEqual(
    blocks.map((b) => [b.attribution.kind, b.attribution.source] as const),
    [
      ['assistant', 'TaskGet'],
      ['tool_result', 'TaskGet'],
    ],
  );
});

// W2 hardening: tool names come from an untrusted log — prototype-chain
// names must fall back to the default prior, not resolve Object.prototype.
test('schemaPrior: prototype-chain names get the default prior, never NaN', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const p = schemaPrior(name);
    assert.equal(typeof p.value, 'number');
    assert.ok(Number.isFinite(p.value) && p.value > 0, `${name} → ${p.value}`);
    assert.ok(p.errorBand!.every(Number.isFinite));
  }
});

// W2 degradation: malformed delta attachments (wrong payload types) must not
// crash, not emit roster events, and not fabricate blocks.
test('claude-code adapter: malformed delta attachments degrade silently', async () => {
  const lines = [
    { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: 'not-an-array' } },
    { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: [1, null, 'Real'] } },
    { type: 'attachment', attachment: { type: 'mcp_instructions_delta' } },
    userText('hi'),
    assistantRec('req_1', [{ type: 'text', text: 'ok' }]),
  ];
  const { frames, anomalies, rosters } = await collect(claudeCodeAdapter.parse(byteStream(lines), { sourceId: 'f' }));
  assert.equal(anomalies.length, 0);
  // Only the one string name survives filtering.
  assert.deepEqual(rosters.length, 1);
  assert.deepEqual(rosters[0]!.deferredAdded, ['Real']);
  // No phantom system blocks from empty bodies.
  const systems = frames[0]!.blocks.filter((b) => b.attribution.kind === 'system');
  assert.equal(systems.length, 1);
});

// Regression: anomaly details must not leak raw content via V8's JSON.parse
// error excerpts.
test('claude-code adapter: unparseable anomaly detail carries no source excerpt', async () => {
  const secret = '{"content": sk-ant-secret-key-fragment}';
  const { anomalies } = await collect(claudeCodeAdapter.parse(byteStream([userText('x')], secret + '\n'), { sourceId: 'f' }));
  const bad = anomalies.find((a) => a.code === 'unparseable');
  assert.ok(bad);
  assert.ok(!bad.detail.includes('sk-ant'), `detail leaks content: ${bad.detail}`);
  assert.ok(!bad.redactedSample.includes('sk-ant'), `sample leaks content: ${bad.redactedSample}`);
});
