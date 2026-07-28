import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActionProposals, diagnoseSession } from '../dist/index.js';

const calibration = { scale: 1, resident: { value: 0, method: 'calibrated-heuristic' }, r2: 0.98, n: 2, residualStd: 0 };

test('diagnosis turns report evidence into prioritized, actionable findings', () => {
  const result = diagnoseSession({
    frames: [{
      seq: 8,
      at: 0,
      model: { model: 'test' },
      totals: { input: 220_000 },
      providerUsage: { source: 'log', inputAccounting: 'includes-cache' },
      delta: { addedTokens: 1_000, carriedTokens: 9_000 },
      kinds: { tool_result: 9_000 },
      blocks: [{ id: 'b1', attribution: { kind: 'tool_result', confidence: 'exact', source: 'exec' }, sourceRef: { sourceId: 'x', record: 1 }, tokens: { value: 9_000, method: 'calibrated-heuristic' }, hash: 'h1' }],
      usage: [{ blockId: 'b1', introducedSeq: 1, ageFrames: 25 }],
      calibration,
    }],
    compactions: [{ atSeq: 8, before: 7, after: 8, fates: [], stats: { beforeTokens: 220_000, afterTokens: 30_000, droppedTokens: 0, unobservedTokens: 180_000, summarizedTokens: 0, compressionRatio: 0.136 } }],
    usage: { totals: { calls: 8, input: 500_000, uncachedInput: 50_000, cacheRead: 450_000, cacheWrite: 0, output: 10_000, reasoningOutput: 0 }, cacheHitRate: 0.9, byModel: [], sources: [{ source: 'log', calls: 8 }] },
    tools: { called: [{ name: 'exec', calls: 4, inputTokens: 1_000, resultTokens: 30_000 }] },
    calibrationSegments: [{ fromSeq: 1, toSeq: 8, reason: 'session-start', model: 'test', calibration }],
    anomalyCount: 0,
  });

  assert.equal(result.verdict, 'critical');
  assert.equal(result.issueCount, 3);
  assert.deepEqual(result.findings.map((finding) => finding.kind), [
    'context-peak',
    'persistent-block',
    'tool-overhead',
    'compaction',
    'cache-efficiency',
  ]);
  assert.equal(result.findings.at(-1)?.severity, 'positive');
  assert.equal(result.findings[0]?.ruleId, 'context.peak');
  assert.deepEqual(result.findings[0]?.evidence, [
    { kind: 'frame', frameSeq: 8 },
    { kind: 'usage', fromSeq: 8, toSeq: 8 },
  ]);
  assert.ok(result.findings.every((finding) => finding.evidence.length > 0));
  assert.ok(result.findings.every((finding) => finding.recommendation.mode));
  const cacheFinding = result.findings.find((finding) => finding.kind === 'cache-efficiency');
  assert.equal(cacheFinding?.impact?.estimatedWasteTokens, undefined);
});

test('diagnosis detects simultaneously duplicated context with source evidence', () => {
  const result = diagnoseSession({
    frames: [{
      seq: 3,
      at: 0,
      model: { model: 'test' },
      totals: { input: 8_000 },
      providerUsage: { source: 'log', inputAccounting: 'includes-cache' },
      delta: { addedTokens: 3_000, carriedTokens: 5_000 },
      kinds: { tool_result: 3_600 },
      blocks: [1, 2, 3].map((record) => ({
        id: `duplicate-${record}`,
        attribution: { kind: 'tool_result', confidence: 'exact', source: 'exec' },
        sourceRef: { sourceId: 'x', record },
        tokens: { value: 1_200, method: 'tokenizer' },
        hash: 'same-content',
      })),
      usage: [],
      calibration,
    }],
    compactions: [],
    usage: { totals: { calls: 0, input: 0, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 }, cacheHitRate: 0, byModel: [], sources: [] },
    tools: { called: [] },
    calibrationSegments: [{ fromSeq: 1, toSeq: 3, reason: 'session-start', model: 'test', calibration }],
    anomalyCount: 0,
  });

  const finding = result.findings.find((candidate) => candidate.kind === 'duplicate-content');
  assert.ok(finding);
  assert.equal(finding.copies, 3);
  assert.equal(finding.tokens, 2_400);
  assert.equal(finding.evidence.length, 3);
  assert.equal(finding.impact?.estimatedSavingTokens?.method, 'tokenizer');
});

test('diagnosis reports loaded schemas that were never called without inventing exact pricing', () => {
  const result = diagnoseSession({
    frames: [{
      seq: 1,
      at: 0,
      model: { model: 'test' },
      totals: { input: 2_000 },
      providerUsage: { source: 'log', inputAccounting: 'includes-cache' },
      delta: { addedTokens: 0, carriedTokens: 0 },
      kinds: {},
      blocks: [],
      usage: [],
      calibration,
    }],
    compactions: [],
    usage: { totals: { calls: 0, input: 0, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 }, cacheHitRate: 0, byModel: [], sources: [] },
    tools: {
      called: [],
      loadedNeverCalled: ['TaskList', 'WebFetch'],
      wastedSchemaTokens: { value: 840, method: 'prior', errorBand: [420, 2_100] },
    },
    calibrationSegments: [{ fromSeq: 1, toSeq: 1, reason: 'session-start', model: 'test', calibration }],
    anomalyCount: 0,
  });

  const finding = result.findings.find((candidate) => candidate.kind === 'idle-tools');
  assert.ok(finding);
  assert.equal(finding.confidence, 'exact');
  assert.equal(finding.tokens, 840);
  assert.equal(finding.impact?.estimatedWasteTokens?.method, 'prior');
});

test('action proposals expose execution location without claiming apply support', () => {
  const capabilities = {
    readLogs: 'full',
    exactUsage: 'partial',
    exactRequest: 'none',
    compactionMarkers: 'full',
    preToolHook: 'unknown',
    rewriteOutput: 'partial',
    toolAllowlist: 'none',
    modelRouting: 'none',
    compactionControl: 'unknown',
  };
  const findings = [
    {
      ruleId: 'tool.output-overhead',
      severity: 'warning',
      confidence: 'inferred',
      scope: { kind: 'tool', toolName: 'exec' },
      evidence: [{ kind: 'tool', toolName: 'exec' }],
      recommendation: { action: 'compress-tool-output', mode: 'suggest', risk: 'medium' },
    },
    {
      ruleId: 'tool.loaded-never-called',
      severity: 'info',
      confidence: 'exact',
      scope: { kind: 'tool', toolName: 'unused' },
      evidence: [{ kind: 'tool', toolName: 'unused' }],
      recommendation: { action: 'defer-unused-tools', mode: 'suggest', risk: 'low' },
    },
    {
      ruleId: 'evidence.low-calibration-confidence',
      severity: 'warning',
      confidence: 'exact',
      scope: { kind: 'session' },
      evidence: [{ kind: 'calibration', fromSeq: 1, toSeq: 2 }],
      recommendation: { action: 'inspect-calibration', mode: 'observe', risk: 'low' },
    },
  ];

  const proposals = buildActionProposals(findings, capabilities);
  assert.equal(proposals[0].execution.target, 'tool-hook');
  assert.equal(proposals[0].execution.availability, 'bridge-required');
  assert.equal(proposals[0].execution.capabilitySupport, 'partial');
  assert.equal(proposals[0].preview.writesFiles, false);
  assert.equal(proposals[1].execution.target, 'agent-config');
  assert.equal(proposals[1].execution.availability, 'manual-only');
  assert.equal(proposals[2].execution.target, 'tokray');
  assert.equal(proposals[2].execution.appliesTo, 'current-analysis');
  assert.equal(proposals[2].preview.requiresApproval, false);
});
