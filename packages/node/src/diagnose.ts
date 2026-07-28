import type { CalibrationSegment, CompactionEvent, TokenCount } from '@tokray/core';
import type {
  AnalysisFrame,
  SessionDiagnosis,
  SessionFinding,
  UsageSummary,
} from './types.js';

interface DiagnosisInput {
  frames: readonly AnalysisFrame[];
  compactions: readonly CompactionEvent[];
  usage: UsageSummary;
  tools: {
    called: ReadonlyArray<{ name: string; calls: number; inputTokens: number; resultTokens: number }>;
    loadedNeverCalled?: readonly string[];
    wastedSchemaTokens?: TokenCount;
  };
  calibrationSegments: readonly CalibrationSegment[];
  anomalyCount: number;
}

const rank: Record<SessionFinding['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

/** Conservative, explainable findings derived only from report evidence. */
export function diagnoseSession(input: DiagnosisInput): SessionDiagnosis {
  const findings: SessionFinding[] = [];
  const peak = input.frames.reduce((best, frame) => frame.totals.input > best.totals.input ? frame : best, input.frames[0]!);
  if (peak.totals.input >= 100_000) {
    findings.push({
      ruleId: 'context.peak',
      kind: 'context-peak',
      severity: peak.totals.input >= 200_000 ? 'critical' : 'warning',
      confidence: peak.providerUsage.source === 'estimated' ? 'guessed' : 'exact',
      scope: { kind: 'frame', frameSeq: peak.seq },
      evidence: [{ kind: 'frame', frameSeq: peak.seq }, { kind: 'usage', fromSeq: peak.seq, toSeq: peak.seq }],
      impact: {
        currentTokens: {
          value: peak.totals.input,
          method: peak.providerUsage.source === 'estimated' ? 'calibrated-heuristic' : 'exact-api',
        },
      },
      recommendation: { action: 'inspect-context-peak', mode: 'suggest', risk: 'low' },
      frameSeq: peak.seq,
      tokens: peak.totals.input,
      target: 'frames',
    });
  }

  let persistent: {
    frameSeq: number;
    blockId: AnalysisFrame['blocks'][number]['id'];
    sourceRef: AnalysisFrame['blocks'][number]['sourceRef'];
    source: string;
    tokenCount: AnalysisFrame['blocks'][number]['tokens'];
    tokens: number;
    ageFrames: number;
    score: number;
  } | undefined;
  for (const frame of input.frames) {
    const ageByBlock = new Map(frame.usage.map((usage) => [String(usage.blockId), usage.ageFrames]));
    for (const block of frame.blocks) {
      if (block.attribution.kind === 'system' || block.attribution.kind === 'tool_schema') continue;
      const ageFrames = ageByBlock.get(block.id) ?? 1;
      if (ageFrames < 8 || block.tokens.value < 1_000) continue;
      const candidate = {
        frameSeq: frame.seq,
        blockId: block.id,
        sourceRef: block.sourceRef,
        source: block.attribution.source ?? block.attribution.kind,
        tokenCount: block.tokens,
        tokens: block.tokens.value,
        ageFrames,
        score: block.tokens.value * Math.min(ageFrames, 50),
      };
      if (!persistent || candidate.score > persistent.score) persistent = candidate;
    }
  }
  if (persistent) {
    findings.push({
      ruleId: 'context.persistent-block',
      kind: 'persistent-block',
      severity: persistent.tokens >= 5_000 && persistent.ageFrames >= 20 ? 'warning' : 'info',
      confidence: persistent.tokenCount.method === 'exact-api' || persistent.tokenCount.method === 'tokenizer'
        ? 'exact'
        : 'inferred',
      scope: { kind: 'block', frameSeq: persistent.frameSeq, blockId: persistent.blockId },
      evidence: [{
        kind: 'block',
        frameSeq: persistent.frameSeq,
        blockId: persistent.blockId,
        sourceRef: persistent.sourceRef,
      }],
      impact: { currentTokens: persistent.tokenCount },
      recommendation: { action: 'review-persistent-block', mode: 'suggest', risk: 'medium' },
      frameSeq: persistent.frameSeq,
      source: persistent.source,
      tokens: persistent.tokens,
      ageFrames: persistent.ageFrames,
      target: 'frames',
    });
  }

  const topTool = [...input.tools.called]
    .map((tool) => ({ ...tool, tokens: tool.inputTokens + tool.resultTokens }))
    .sort((left, right) => right.tokens - left.tokens)[0];
  if (topTool && topTool.tokens >= 3_000) {
    findings.push({
      ruleId: 'tool.output-overhead',
      kind: 'tool-overhead',
      severity: topTool.tokens >= 20_000 ? 'warning' : 'info',
      confidence: 'inferred',
      scope: { kind: 'tool', toolName: topTool.name },
      evidence: [{ kind: 'tool', toolName: topTool.name }],
      impact: { currentTokens: { value: topTool.tokens, method: 'calibrated-heuristic' } },
      recommendation: { action: 'compress-tool-output', mode: 'suggest', risk: 'medium' },
      source: topTool.name,
      tokens: topTool.tokens,
      calls: topTool.calls,
      target: 'tools',
    });
  }

  let duplicate: {
    frameSeq: number;
    blocks: AnalysisFrame['blocks'];
    source: string;
    tokens: TokenCount;
    wasteTokens: TokenCount;
  } | undefined;
  const duplicateKinds = new Set(['tool_result', 'file_ref', 'memory', 'skill', 'unknown']);
  for (const frame of input.frames) {
    const byHash = new Map<string, AnalysisFrame['blocks']>();
    for (const block of frame.blocks) {
      if (!duplicateKinds.has(block.attribution.kind)) continue;
      const matches = byHash.get(block.hash) ?? [];
      if (!matches.some((candidate) => candidate.id === block.id)) byHash.set(block.hash, [...matches, block]);
    }
    for (const blocks of byHash.values()) {
      if (blocks.length < 2) continue;
      const representative = blocks[0]!;
      const wasteMultiplier = blocks.length - 1;
      const wasteValue = representative.tokens.value * wasteMultiplier;
      if (wasteValue < 1_000) continue;
      const multiply = (count: TokenCount, multiplier: number): TokenCount => ({
        ...count,
        value: count.value * multiplier,
        ...(count.errorBand
          ? { errorBand: [count.errorBand[0] * multiplier, count.errorBand[1] * multiplier] as const }
          : {}),
      });
      const candidate = {
        frameSeq: frame.seq,
        blocks,
        source: representative.attribution.source ?? representative.attribution.kind,
        tokens: multiply(representative.tokens, blocks.length),
        wasteTokens: multiply(representative.tokens, wasteMultiplier),
      };
      if (!duplicate || candidate.wasteTokens.value > duplicate.wasteTokens.value) duplicate = candidate;
    }
  }
  if (duplicate) {
    const first = duplicate.blocks[0]!;
    findings.push({
      ruleId: 'context.duplicate-content',
      kind: 'duplicate-content',
      severity: duplicate.wasteTokens.value >= 5_000 ? 'warning' : 'info',
      confidence: 'inferred',
      scope: { kind: 'block', frameSeq: duplicate.frameSeq, blockId: first.id },
      evidence: duplicate.blocks.map((block) => ({
        kind: 'block' as const,
        frameSeq: duplicate!.frameSeq,
        blockId: block.id,
        sourceRef: block.sourceRef,
      })),
      impact: {
        currentTokens: duplicate.tokens,
        estimatedWasteTokens: duplicate.wasteTokens,
        estimatedSavingTokens: duplicate.wasteTokens,
      },
      recommendation: { action: 'deduplicate-context-content', mode: 'suggest', risk: 'low' },
      frameSeq: duplicate.frameSeq,
      source: duplicate.source,
      copies: duplicate.blocks.length,
      tokens: duplicate.wasteTokens.value,
      target: 'frames',
    });
  }

  const idleTools = input.tools.loadedNeverCalled ?? [];
  if (idleTools.length > 0) {
    const wasted = input.tools.wastedSchemaTokens;
    findings.push({
      ruleId: 'tool.loaded-never-called',
      kind: 'idle-tools',
      severity: idleTools.length >= 5 || (wasted?.value ?? 0) >= 2_000 ? 'warning' : 'info',
      confidence: 'exact',
      scope: { kind: 'tool', toolName: idleTools[0]! },
      evidence: idleTools.map((toolName) => ({ kind: 'tool' as const, toolName })),
      ...(wasted && wasted.value > 0
        ? { impact: { currentTokens: wasted, estimatedWasteTokens: wasted, estimatedSavingTokens: wasted } }
        : {}),
      recommendation: { action: 'defer-unused-tools', mode: 'suggest', risk: 'low' },
      source: idleTools[0]!,
      count: idleTools.length,
      tokens: wasted?.value ?? 0,
      target: 'tools',
    });
  }

  const lastCompaction = input.compactions.at(-1);
  if (lastCompaction) {
    findings.push({
      ruleId: 'context.compaction',
      kind: 'compaction',
      severity: input.compactions.length >= 2 ? 'warning' : 'info',
      confidence: lastCompaction.stats.unobservedTokens > 0 ? 'inferred' : 'exact',
      scope: { kind: 'compaction', atSeq: lastCompaction.atSeq },
      evidence: [{ kind: 'compaction', atSeq: lastCompaction.atSeq }],
      impact: {
        currentTokens: { value: lastCompaction.stats.beforeTokens, method: 'exact-api' },
        estimatedSavingTokens: {
          value: Math.max(0, lastCompaction.stats.beforeTokens - lastCompaction.stats.afterTokens),
          method: lastCompaction.stats.unobservedTokens > 0 ? 'calibrated-heuristic' : 'exact-api',
        },
      },
      recommendation: { action: 'review-compaction', mode: 'suggest', risk: 'high' },
      count: input.compactions.length,
      reduction: Math.max(0, 1 - lastCompaction.stats.compressionRatio),
      unobservedTokens: lastCompaction.stats.unobservedTokens,
      target: 'compaction',
    });
  }

  if (input.usage.totals.calls > 0) {
    const percentage = input.usage.cacheHitRate;
    findings.push({
      ruleId: 'cache.efficiency',
      kind: 'cache-efficiency',
      severity: percentage >= 0.8
        ? 'positive'
        : percentage < 0.3 && input.usage.totals.input >= 100_000
          ? 'warning'
          : 'info',
      confidence: 'exact',
      scope: { kind: 'session' },
      evidence: [{ kind: 'usage' }],
      impact: {
        currentTokens: { value: input.usage.totals.input, method: 'exact-api' },
      },
      recommendation: {
        action: percentage >= 0.8 ? 'preserve-cache-prefix' : 'stabilize-cache-prefix',
        mode: percentage >= 0.8 ? 'observe' : 'suggest',
        risk: 'low',
      },
      percentage,
      input: input.usage.totals.input,
      uncachedInput: input.usage.totals.uncachedInput,
      target: 'usage',
    });
  }

  const lowConfidence = input.calibrationSegments.filter((segment) => segment.calibration.r2 < 0.7);
  if (lowConfidence.length > 0) {
    findings.push({
      ruleId: 'evidence.low-calibration-confidence',
      kind: 'low-confidence',
      severity: 'warning',
      confidence: 'exact',
      scope: { kind: 'frame', frameSeq: lowConfidence[0]!.fromSeq },
      evidence: [{
        kind: 'calibration',
        fromSeq: lowConfidence[0]!.fromSeq,
        toSeq: lowConfidence[0]!.toSeq,
      }],
      recommendation: { action: 'inspect-calibration', mode: 'observe', risk: 'low' },
      count: lowConfidence.length,
      frameSeq: lowConfidence[0]!.fromSeq,
      target: 'overview',
    });
  }

  if (input.anomalyCount > 0) {
    findings.push({
      ruleId: 'adapter.parser-anomaly',
      kind: 'parser-issues',
      severity: 'warning',
      confidence: 'exact',
      scope: { kind: 'session' },
      evidence: [{ kind: 'anomaly' }],
      recommendation: { action: 'review-adapter-anomalies', mode: 'observe', risk: 'low' },
      count: input.anomalyCount,
      target: 'anomalies',
    });
  }

  findings.sort((left, right) => rank[left.severity] - rank[right.severity]);
  const issueCount = findings.filter((finding) => finding.severity === 'warning' || finding.severity === 'critical').length;
  return {
    verdict: findings.some((finding) => finding.severity === 'critical')
      ? 'critical'
      : issueCount > 0
        ? 'attention'
        : 'healthy',
    issueCount,
    findings,
  };
}
