import assert from 'node:assert/strict';
import test from 'node:test';
import { governNativeRequest } from '../dist/index.js';

function openAiRequest() {
  return {
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'Never alter this instruction.' },
      { role: 'user', content: 'Inspect src/main.ts and explain the failure.' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Please simply read a file in order to return its contents to the caller.',
          parameters: {
            type: 'object',
            description: 'Please provide the input values that are needed in order to read the file.',
            properties: {
              path: {
                type: 'string',
                description: 'Please provide the exact file path such as ./src/main.ts.',
                default: './README.md',
              },
              mode: { type: 'string', enum: ['text', 'binary'], default: 'text' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
    ],
  };
}

test('governs OpenAI tool descriptions without changing messages or tool contracts', () => {
  const input = openAiRequest();
  const snapshot = structuredClone(input);
  const result = governNativeRequest(input);

  assert.equal(result.requestProvider, 'openai-compatible');
  assert.equal(result.changed, true);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.request.messages, snapshot.messages);
  assert.deepEqual(result.request.tools[0].function.parameters.properties.path.default, './README.md');
  assert.deepEqual(result.request.tools[0].function.parameters.properties.mode.enum, ['text', 'binary']);
  assert.equal(result.request.tools[0].function.name, 'read_file');
  assert.notEqual(result.request.tools[0].function.description, snapshot.tools[0].function.description);
  assert.notEqual(result.request.tools[0].function.parameters.description, snapshot.tools[0].function.parameters.description);
  assert.ok(result.tools.descriptionFieldsCompacted >= 2);
  assert.ok(result.governed.estimatedTokens.value < result.original.estimatedTokens.value);
  assert.deepEqual(result.integrity, {
    messageContentPreserved: true,
    retainedToolContractsPreserved: true,
    originalInputUnmodified: true,
  });
});

test('governs Anthropic top-level and nested schema descriptions while preserving system content', () => {
  const input = {
    model: 'claude-sonnet-4',
    max_tokens: 1024,
    system: [{ type: 'text', text: 'System content stays byte-for-byte equivalent.' }],
    messages: [{ role: 'user', content: 'List the directory.' }],
    tools: [{
      name: 'list_directory',
      description: 'Please kindly list a directory in order to return all of its entries.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Please simply provide the directory path.' },
        },
        required: ['path'],
      },
    }],
  };
  const result = governNativeRequest(input);

  assert.equal(result.requestProvider, 'anthropic-compatible');
  assert.deepEqual(result.request.system, input.system);
  assert.deepEqual(result.request.messages, input.messages);
  assert.equal(result.request.tools[0].name, input.tools[0].name);
  assert.deepEqual(result.request.tools[0].input_schema.required, ['path']);
  assert.notEqual(result.request.tools[0].description, input.tools[0].description);
  assert.notEqual(
    result.request.tools[0].input_schema.properties.path.description,
    input.tools[0].input_schema.properties.path.description,
  );
});

test('preserves code, URLs, paths, environment variables, and placeholders inside descriptions', () => {
  const protectedValues = [
    '`pnpm test --filter core`',
    'https://docs.example.test/tools/read?q=1',
    './src/main.ts',
    '${API_TOKEN}',
    '{request_id}',
    '<workspace>',
  ];
  const input = openAiRequest();
  input.tools[0].function.description = `Please simply run ${protectedValues.join(' and ')} in order to inspect input.`;
  const result = governNativeRequest(input);
  const description = result.request.tools[0].function.description;

  for (const value of protectedValues) assert.ok(description.includes(value), value);
  assert.ok(description.length < input.tools[0].function.description.length);
});

test('removes only byte-identical duplicate tools by default', () => {
  const input = openAiRequest();
  const duplicate = structuredClone(input.tools[0]);
  const sameContractDifferentDescription = structuredClone(input.tools[0]);
  sameContractDifferentDescription.function.description = 'Read the requested file and return its content.';
  input.tools.push(duplicate, sameContractDifferentDescription);

  const result = governNativeRequest(input);

  assert.equal(result.tools.originalCount, 3);
  assert.equal(result.tools.governedCount, 2);
  assert.equal(result.tools.exactDuplicatesRemoved, 1);
  assert.equal(result.request.tools[1].function.description, sameContractDifferentDescription.function.description);
});

test('applies a tool allowlist only when explicitly supplied and retains unnamed tools with a warning', () => {
  const base = openAiRequest();
  base.tools.push(
    { type: 'function', function: { name: 'write_file', description: 'Write a file.', parameters: { type: 'object' } } },
    { type: 'custom', description: 'Please simply keep this unnamed transport tool.' },
  );

  const defaultResult = governNativeRequest(base);
  assert.equal(defaultResult.tools.governedCount, 3);
  assert.deepEqual(defaultResult.tools.allowlistRemoved, []);

  const allowedResult = governNativeRequest(base, { allowedTools: ['read_file'] });
  assert.deepEqual(allowedResult.tools.allowlistRemoved, ['write_file']);
  assert.equal(allowedResult.tools.unnamedRetained, 1);
  assert.equal(allowedResult.tools.governedCount, 2);
  assert.ok(allowedResult.warnings.includes('unnamed-tools-retained-outside-allowlist'));
});

test('blocks an over-budget request without truncating messages, system, or input', () => {
  const input = {
    model: 'gpt-5',
    input: [{ role: 'user', content: 'x'.repeat(4_000) }],
    tools: [],
  };
  const result = governNativeRequest(input, { maxInputTokens: 8 });

  assert.equal(result.budget.status, 'over-budget');
  assert.equal(result.budget.sendAllowed, false);
  assert.deepEqual(result.request.input, input.input);
  assert.ok(result.warnings.includes('request-blocked-by-estimated-input-budget'));
});

test('rejects invalid budgets and oversized requests', () => {
  assert.throws(() => governNativeRequest(openAiRequest(), { maxInputTokens: 0 }), /positive integer/);
  assert.throws(
    () => governNativeRequest({ model: 'gpt-5', input: 'x'.repeat(2_000_001) }),
    /2,000,000 character governance limit/,
  );
});
