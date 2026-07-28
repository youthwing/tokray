import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBlockContent } from '../dist/content.js';

const block = (kind, pointer, source) => ({
  id: 'b1',
  attribution: { kind, confidence: 'exact', ...(source ? { source } : {}) },
  sourceRef: { sourceId: 'fixture', record: 1, ...(pointer ? { pointer } : {}) },
  tokens: { value: 1, method: 'exact-tokenizer' },
});

test('extractBlockContent follows JSON pointers for Codex records', () => {
  const record = { payload: { content: [{ type: 'input_text', text: 'hello codex' }] } };
  assert.equal(extractBlockContent(record, block('user', '/payload/content')), 'hello codex');
});

test('extractBlockContent selects Claude tool calls without retaining text in core', () => {
  const record = { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }, { type: 'tool_use', name: 'exec', input: { cmd: 'pwd' } }] } };
  assert.equal(extractBlockContent(record, block('assistant', undefined, 'exec')), 'exec\n{\n  "cmd": "pwd"\n}');
});
