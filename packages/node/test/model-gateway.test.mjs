import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { startModelGateway } from '../dist/index.js';

async function startUpstream(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('upstream did not bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('model gateway governs JSON, preserves auth and path, and streams the upstream response', async () => {
  let observed;
  const upstream = await startUpstream(async (request, response) => {
    observed = {
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(await body(request)),
    };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: {"delta":"first"}\n\n');
    setTimeout(() => response.end('data: [DONE]\n\n'), 10);
  });
  const events = [];
  const gateway = await startModelGateway({
    upstreamBaseUrl: `${upstream.url}/provider`,
    port: 0,
    governance: { compactToolResults: true, toolResultMinChars: 100 },
    onEvent: (event) => events.push(event),
  });
  try {
    const repeated = Array.from({ length: 80 }, () => 'BUILD_PROGRESS compiling deterministic module').join('\n');
    const request = {
      model: 'gpt-test',
      stream: true,
      messages: [
        { role: 'user', content: repeated },
        { role: 'tool', tool_call_id: 'call-1', content: `${repeated}\nSTATUS=PASS` },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'build',
          description: 'Please simply run the build in order to return all output to the caller.',
          parameters: { type: 'object', properties: {} },
        },
      }],
    };
    const response = await fetch(`${gateway.url}/v1/chat/completions?trace=1`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-tokray-governed'), 'true');
    assert.equal(await response.text(), 'data: {"delta":"first"}\n\ndata: [DONE]\n\n');
    assert.equal(observed.url, '/provider/v1/chat/completions?trace=1');
    assert.equal(observed.authorization, 'Bearer test-secret');
    assert.equal(observed.body.messages[0].content, repeated);
    assert.equal(observed.body.messages[1].tool_call_id, 'call-1');
    assert.match(observed.body.messages[1].content, /repeated previous line 79 more times/);
    assert.match(observed.body.messages[1].content, /STATUS=PASS/);
    assert.ok(observed.body.tools[0].function.description.length < request.tools[0].function.description.length);

    const health = await fetch(`${gateway.url}/__tokray/health`).then((item) => item.json());
    assert.equal(health.ok, true);
    const stats = await fetch(`${gateway.url}/__tokray/stats`).then((item) => item.json());
    assert.equal(stats.requests, 1);
    assert.equal(stats.forwarded, 1);
    assert.equal(stats.governed, 1);
    assert.ok(stats.estimatedSavedTokens > 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].governance.toolResultsCompacted, 1);
    assert.equal(events[0].responseBytes, Buffer.byteLength('data: {"delta":"first"}\n\ndata: [DONE]\n\n'));
  } finally {
    await gateway.close();
    await upstream.close();
  }
});

test('model gateway blocks an over-budget request before calling upstream', async () => {
  let upstreamCalls = 0;
  const upstream = await startUpstream((_request, response) => {
    upstreamCalls++;
    response.end('{}');
  });
  const gateway = await startModelGateway({
    upstreamBaseUrl: upstream.url,
    port: 0,
    governance: { maxInputTokens: 8 },
  });
  try {
    const response = await fetch(`${gateway.url}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-test', input: 'x'.repeat(4_000) }),
    });
    const result = await response.json();

    assert.equal(response.status, 422);
    assert.equal(result.error.code, 'tokray_input_budget_exceeded');
    assert.equal(result.governance.budgetStatus, 'over-budget');
    assert.equal(upstreamCalls, 0);
    assert.equal(gateway.stats().blocked, 1);
  } finally {
    await gateway.close();
    await upstream.close();
  }
});

test('model gateway passes non-model GET requests through without governance', async () => {
  const upstream = await startUpstream((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ path: request.url }));
  });
  const gateway = await startModelGateway({ upstreamBaseUrl: upstream.url, port: 0 });
  try {
    const response = await fetch(`${gateway.url}/v1/models`);
    assert.deepEqual(await response.json(), { path: '/v1/models' });
    assert.equal(response.headers.get('x-tokray-governed'), 'false');
    assert.equal(gateway.stats().forwarded, 1);
    assert.equal(gateway.stats().governed, 0);
  } finally {
    await gateway.close();
    await upstream.close();
  }
});
