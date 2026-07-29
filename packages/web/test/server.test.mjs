import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../dist-server/server.js';

async function preview(body) {
  return app.request('/api/governance/native-request/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('native request preview governs a valid request and preserves its message contract', async () => {
  const request = {
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'Inspect src/main.ts.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Please simply read a file in order to return its contents.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    }],
  };

  const response = await preview({ request });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.request.messages, request.messages);
  assert.equal(result.request.tools[0].function.name, 'read_file');
  assert.deepEqual(result.request.tools[0].function.parameters, request.tools[0].function.parameters);
  assert.notEqual(result.request.tools[0].function.description, request.tools[0].function.description);
  assert.equal(result.budget.sendAllowed, true);
  assert.equal(result.integrity.messageContentPreserved, true);
  assert.equal(result.integrity.retainedToolContractsPreserved, true);
});

test('native request preview returns an inspectable candidate when the budget blocks sending', async () => {
  const request = {
    model: 'gpt-5',
    input: [{ role: 'user', content: 'x'.repeat(4_000) }],
    tools: [],
  };

  const response = await preview({ request, maxInputTokens: 8 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.request.input, request.input);
  assert.equal(result.budget.status, 'over-budget');
  assert.equal(result.budget.sendAllowed, false);
  assert.ok(result.warnings.includes('request-blocked-by-estimated-input-budget'));
});

test('native request preview rejects malformed request bodies and options', async () => {
  const missingRequest = await preview({ request: [] });
  assert.equal(missingRequest.status, 400);
  assert.deepEqual(await missingRequest.json(), { error: 'request must be a JSON object' });

  const invalidAllowlist = await preview({ request: {}, allowedTools: ['read_file', 42] });
  assert.equal(invalidAllowlist.status, 400);
  assert.deepEqual(await invalidAllowlist.json(), { error: 'allowedTools must be an array of strings' });

  const invalidBudget = await preview({ request: {}, maxInputTokens: 0 });
  assert.equal(invalidBudget.status, 400);
  assert.deepEqual(await invalidBudget.json(), { error: 'maxInputTokens must be a positive integer' });
});

test('Codex Hook connection API exposes the Agent-write and trust boundary before apply', async () => {
  const preview = await app.request('/api/integrations/hooks/codex/preview', { method: 'POST' });
  assert.equal(preview.status, 200);
  const result = await preview.json();
  assert.equal(result.hookEvent, 'PostToolUse');
  assert.equal(result.writesAgentConfig, true);
  assert.equal(result.requiresCodexTrust, true);
  assert.equal(result.activation, 'agent-config-written-trust-required');
  assert.match(result.path, /\.codex\/hooks\.json$/);

  const rejectedApply = await app.request('/api/integrations/hooks/codex/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approved: false, expectedAfterHash: result.afterHash }),
  });
  assert.equal(rejectedApply.status, 400);
  assert.deepEqual(await rejectedApply.json(), { error: 'Explicit approval is required' });
});
