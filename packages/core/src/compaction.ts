import type {
  AlignOptions,
  BlockFate,
  BlockId,
  CompactionEvent,
  ContextBlock,
  ContextFrame,
  DropSeverity,
} from './types.js';

function overlap<T>(left: readonly T[], right: readonly T[]): T[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => rightSet.has(value));
}

function chunkScore(left: ContextBlock, right: ContextBlock): number {
  const leftChunks = left.features?.chunks ?? [];
  const rightChunks = right.features?.chunks ?? [];
  if (leftChunks.length === 0 || rightChunks.length === 0) return 0;
  return overlap(leftChunks, rightChunks).length / Math.min(leftChunks.length, rightChunks.length);
}

function identifierMatch(left: ContextBlock, right: ContextBlock): { coverage: number; evidence: string[] } {
  const leftIdentifiers = left.features?.idents ?? [];
  const rightIdentifiers = right.features?.idents ?? [];
  if (leftIdentifiers.length === 0 || rightIdentifiers.length === 0) return { coverage: 0, evidence: [] };
  const evidence = overlap(leftIdentifiers, rightIdentifiers);
  return { coverage: evidence.length / leftIdentifiers.length, evidence };
}

function severityFor(block: ContextBlock, frame: ContextFrame): DropSeverity {
  const age = frame.usage.find((usage) => usage.blockId === block.id)?.ageFrames ?? 1;
  if (block.attribution.kind === 'summary' || (block.attribution.kind === 'user' && age >= 8)) return 'critical';
  if (block.tokens.value >= 2_000 || age >= 12) return 'notable';
  if (block.tokens.value <= 32 && age <= 2) return 'noise';
  return 'normal';
}

/** Align two adjacent context frames without loading their source text. */
export function alignCompaction(
  before: ContextFrame,
  after: ContextFrame,
  options: AlignOptions = {},
): readonly BlockFate[] {
  const summaryCoverageThreshold = options.summaryCoverageThreshold ?? 0.18;
  const fates: BlockFate[] = [];
  const summaryObserved = after.blocks.some((block) => block.attribution.kind === 'summary');
  const unmatchedBefore = new Map(before.blocks.map((block) => [block.id, block]));
  const unmatchedAfter = new Map(after.blocks.map((block) => [block.id, block]));

  const afterByHash = new Map<string, ContextBlock[]>();
  for (const block of after.blocks) {
    const matches = afterByHash.get(block.hash) ?? [];
    matches.push(block);
    afterByHash.set(block.hash, matches);
  }
  for (const block of before.blocks) {
    const match = afterByHash.get(block.hash)?.find((candidate) => unmatchedAfter.has(candidate.id));
    if (!match) continue;
    fates.push({ kind: 'kept', from: block.id, to: match.id });
    unmatchedBefore.delete(block.id);
    unmatchedAfter.delete(match.id);
  }

  for (const block of [...unmatchedBefore.values()]) {
    let best: { block: ContextBlock; score: number } | undefined;
    for (const candidate of unmatchedAfter.values()) {
      if (candidate.attribution.kind === 'summary') continue;
      const score = chunkScore(block, candidate);
      if (score >= 0.5 && (!best || score > best.score)) best = { block: candidate, score };
    }
    if (!best) continue;
    const keptTokens = Math.min(block.tokens.value, best.block.tokens.value);
    fates.push({
      kind: 'truncated',
      from: block.id,
      to: best.block.id,
      keptTokens,
      lostTokens: Math.max(0, block.tokens.value - keptTokens),
    });
    unmatchedBefore.delete(block.id);
    unmatchedAfter.delete(best.block.id);
  }

  for (const summary of [...unmatchedAfter.values()].filter((block) => block.attribution.kind === 'summary')) {
    const sources: Array<{ block: ContextBlock; coverage: number; evidence: string[] }> = [];
    for (const block of unmatchedBefore.values()) {
      const match = identifierMatch(block, summary);
      if (match.coverage >= summaryCoverageThreshold && match.evidence.length > 0) {
        sources.push({ block, ...match });
      }
    }
    if (sources.length === 0) continue;
    const sourceTokens = sources.reduce((sum, source) => sum + source.block.tokens.value, 0);
    const weightedCoverage = sources.reduce(
      (sum, source) => sum + source.coverage * source.block.tokens.value,
      0,
    ) / Math.max(1, sourceTokens);
    const evidence = [...new Set(sources.flatMap((source) => source.evidence))].slice(0, 12);
    fates.push({
      kind: 'summarized',
      from: sources.map((source) => source.block.id),
      into: summary.id,
      coverage: weightedCoverage,
      evidence,
    });
    for (const source of sources) unmatchedBefore.delete(source.block.id);
    unmatchedAfter.delete(summary.id);
  }

  for (const block of unmatchedBefore.values()) {
    fates.push(summaryObserved
      ? {
          kind: 'dropped',
          from: block.id,
          lostTokens: block.tokens.value,
          severity: severityFor(block, before),
          why: `${block.attribution.kind} block was not found in the observed post-compaction context`,
        }
      : {
          kind: 'unobserved',
          from: block.id,
          tokens: block.tokens.value,
          severity: severityFor(block, before),
          why: 'the compaction marker has no summary payload, so removal and summarization cannot be distinguished',
        });
  }
  for (const block of unmatchedAfter.values()) fates.push({ kind: 'added', to: block.id });
  return fates;
}

export function buildCompactionEvent(
  before: ContextFrame,
  after: ContextFrame,
  options?: AlignOptions,
): CompactionEvent {
  const fates = alignCompaction(before, after, options);
  const beforeById = new Map(before.blocks.map((block) => [block.id, block]));
  const beforeTokens = before.blocks.reduce((sum, block) => sum + block.tokens.value, 0);
  const afterTokens = after.blocks.reduce((sum, block) => sum + block.tokens.value, 0);
  let droppedTokens = 0;
  let unobservedTokens = 0;
  let summarizedTokens = 0;
  for (const fate of fates) {
    if (fate.kind === 'dropped' || fate.kind === 'truncated') droppedTokens += fate.lostTokens;
    if (fate.kind === 'unobserved') unobservedTokens += fate.tokens;
    if (fate.kind === 'summarized') {
      summarizedTokens += fate.from.reduce((sum, id) => sum + (beforeById.get(id)?.tokens.value ?? 0), 0);
    }
  }
  return {
    atSeq: after.seq,
    before: before.seq,
    after: after.seq,
    fates,
    stats: {
      beforeTokens,
      afterTokens,
      droppedTokens,
      unobservedTokens,
      summarizedTokens,
      compressionRatio: beforeTokens > 0 ? afterTokens / beforeTokens : 1,
    },
  };
}
