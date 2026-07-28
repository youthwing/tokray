import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_CAPABILITY_KEYS, GOVERNANCE_MODES, definePolicy } from '../dist/index.js';

test('governance contracts expose one canonical capability and mode vocabulary', () => {
  assert.equal(new Set(AGENT_CAPABILITY_KEYS).size, AGENT_CAPABILITY_KEYS.length);
  assert.deepEqual(GOVERNANCE_MODES, ['observe', 'suggest', 'approve', 'enforce']);
  assert.ok(AGENT_CAPABILITY_KEYS.includes('readLogs'));
  assert.ok(AGENT_CAPABILITY_KEYS.includes('rewriteOutput'));
});

test('definePolicy preserves a JSON-serializable, scoped policy definition', () => {
  const policy = definePolicy({
    version: 1,
    id: 'project-tool-output-budget',
    ruleId: 'tool.output-overhead',
    enabled: true,
    mode: 'suggest',
    scope: { projectIds: ['tokray'], agents: ['claude-code', 'codex'] },
    parameters: { maxTokens: 4_000, excludeTools: ['screenshot'] },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(policy)), policy);
  assert.equal(policy.parameters.maxTokens, 4_000);
});
