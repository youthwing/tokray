import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  buildCompactionEvent,
  buildToolsReport,
  calibrationForSeq,
  residentBreakdown,
  segmentedCalibrationFor,
} from '@tokray/core';
import type { Anomaly, BlockFate, Calibration, ContextBlock, ContextFrame, TokenCount, ToolRosterDelta } from '@tokray/core';
import { detectAdapter } from '@tokray/adapters';
import { loadTokrayConfiguration } from './config.js';
import type { AnalysisFrame, AnalysisReport, LocalSession } from './types.js';
import { buildActionProposals } from './actions.js';
import { diagnoseSession } from './diagnose.js';

function usageSummary(frames: readonly ContextFrame[]): AnalysisReport['usage'] {
  const empty = () => ({ calls: 0, input: 0, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoningOutput: 0 });
  const totals = empty();
  const byModel = new Map<string, AnalysisReport['usage']['byModel'][number]>();
  const sources = new Map<ContextFrame['providerUsage']['source'], number>();
  for (const frame of frames) {
    if (frame.providerUsage.source === 'estimated') continue;
    const cacheRead = frame.totals.cacheRead ?? 0;
    const cacheWrite = frame.totals.cacheWrite ?? 0;
    const output = frame.totals.output ?? 0;
    const reasoningOutput = frame.providerUsage.reasoningOutputTokens ?? 0;
    const values = {
      calls: 1,
      input: frame.totals.input,
      uncachedInput: Math.max(0, frame.totals.input - cacheRead),
      cacheRead,
      cacheWrite,
      output,
      reasoningOutput,
    };
    for (const key of Object.keys(values) as Array<keyof typeof values>) totals[key] += values[key];
    const provider = frame.model.provider ?? 'unknown';
    const key = `${provider}\u0000${frame.model.model}`;
    const model = byModel.get(key) ?? { provider, model: frame.model.model, ...empty() };
    for (const field of Object.keys(values) as Array<keyof typeof values>) model[field] += values[field];
    byModel.set(key, model);
    sources.set(frame.providerUsage.source, (sources.get(frame.providerUsage.source) ?? 0) + 1);
  }
  return {
    totals,
    cacheHitRate: totals.input > 0 ? totals.cacheRead / totals.input : 0,
    byModel: [...byModel.values()].sort((left, right) => right.input - left.input),
    sources: [...sources].map(([source, calls]) => ({ source, calls })).sort((left, right) => right.calls - left.calls),
  };
}

function scaleFate(fate: BlockFate, calibration: Calibration): BlockFate {
  const scale = (value: number) => Math.round(value * calibration.scale);
  if (fate.kind === 'dropped') return { ...fate, lostTokens: scale(fate.lostTokens) };
  if (fate.kind === 'truncated') return { ...fate, keptTokens: scale(fate.keptTokens), lostTokens: scale(fate.lostTokens) };
  if (fate.kind === 'unobserved') return { ...fate, tokens: scale(fate.tokens) };
  return fate;
}

async function detect(path: string, preferredId: string) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const probe = { head: buffer.subarray(0, bytesRead).toString('utf8'), name: path };
    const runtime = await loadTokrayConfiguration();
    const preferred = runtime.adapters.find((adapter) => adapter.id === preferredId);
    return preferred?.detect(probe).match ? preferred : detectAdapter(probe, runtime.adapters);
  } finally {
    await handle.close();
  }
}

export async function analyzeSession(session: LocalSession & { path: string }): Promise<AnalysisReport> {
  const adapter = await detect(session.path, session.adapter);
  if (!adapter) throw new Error('No adapter recognizes this session');
  const frames: ContextFrame[] = [];
  const anomalies: Anomaly[] = [];
  const roster: ToolRosterDelta[] = [];
  let epilogue: readonly ContextBlock[] = [];
  const stream = createReadStream(session.path) as AsyncIterable<Uint8Array>;
  for await (const event of adapter.parse(stream, { sourceId: session.path })) {
    if (event.t === 'frame') frames.push(event.frame);
    else if (event.t === 'anomaly') anomalies.push(event.anomaly);
    else if (event.t === 'roster') roster.push(event.delta);
    else if (event.t === 'epilogue') epilogue = event.blocks;
  }
  if (frames.length === 0) throw new Error(`Parsed no model calls (${anomalies.length} anomalies)`);

  const calibrationSegments = segmentedCalibrationFor(frames, adapter.capabilities.accounting);
  const calibration = calibrationForSeq(calibrationSegments, frames.at(-1)!.seq);
  const tools = buildToolsReport(frames, roster, epilogue);
  const components = tools.residentSuspects.flatMap((name) => {
    const tokens = adapter.schemaPricer?.price(name);
    return tokens ? [{ label: name, tokens }] : [];
  });
  let wastedSchemaValue = 0;
  let wastedSchemaLow = 0;
  let wastedSchemaHigh = 0;
  for (const name of tools.loadedNeverCalled) {
    const tokens = adapter.schemaPricer?.price(name);
    if (!tokens) continue;
    wastedSchemaValue += tokens.value;
    wastedSchemaLow += tokens.errorBand?.[0] ?? tokens.value;
    wastedSchemaHigh += tokens.errorBand?.[1] ?? tokens.value;
  }
  const wastedSchemaTokens: TokenCount = {
    value: wastedSchemaValue,
    method: 'prior',
    errorBand: [wastedSchemaLow, wastedSchemaHigh],
  };
  const breakdown = residentBreakdown(calibration, components);
  const scale = (value: number, frameCalibration = calibration) => Math.round(value * frameCalibration.scale);
  const mapBlock = (block: ContextBlock, frameCalibration = calibration) => ({
    id: block.id,
    attribution: block.attribution,
    tokens: block.tokens.method === 'prior'
      ? block.tokens
      : { ...block.tokens, value: scale(block.tokens.value, frameCalibration) },
    hash: block.hash,
    sourceRef: block.sourceRef,
  });
  const mappedFrames: AnalysisFrame[] = frames.map((frame) => {
    const frameCalibration = calibrationForSeq(calibrationSegments, frame.seq);
    const kinds = new Map<string, number>();
    for (const block of frame.blocks) {
      const factor = block.tokens.method === 'prior' ? 1 : frameCalibration.scale;
      kinds.set(block.attribution.kind, (kinds.get(block.attribution.kind) ?? 0) + block.tokens.value * factor);
    }
    return {
      seq: frame.seq,
      at: frame.at,
      model: frame.model,
      totals: frame.totals,
      providerUsage: frame.providerUsage,
      delta: {
        addedTokens: scale(frame.delta.addedTokens, frameCalibration),
        carriedTokens: scale(frame.delta.carriedTokens, frameCalibration),
      },
      kinds: Object.fromEntries([...kinds].map(([kind, value]) => [kind, Math.round(value)])),
      blocks: frame.blocks.map((block) => mapBlock(block, frameCalibration)),
      usage: frame.usage,
      calibration: frameCalibration,
      ...(frame.compactionRef !== undefined ? { compactionRef: frame.compactionRef } : {}),
    };
  });
  const compactions = frames.flatMap((after, index) => {
    if (after.compactionRef === undefined) return [];
    const before = frames.find((frame) => frame.seq === after.compactionRef) ?? frames[index - 1];
    if (!before) return [];
    const beforeCalibration = calibrationForSeq(calibrationSegments, before.seq);
    const event = buildCompactionEvent(before, after);
    const fates = event.fates.map((fate) => scaleFate(fate, beforeCalibration));
    const droppedTokens = fates.reduce((sum, fate) => {
      if (fate.kind === 'dropped' || fate.kind === 'truncated') return sum + fate.lostTokens;
      return sum;
    }, 0);
    const summarizedTokens = Math.round(event.stats.summarizedTokens * beforeCalibration.scale);
    const unobservedTokens = fates.reduce(
      (sum, fate) => sum + (fate.kind === 'unobserved' ? fate.tokens : 0),
      0,
    );
    return [{
      ...event,
      fates,
      stats: {
        beforeTokens: before.totals.input,
        afterTokens: after.totals.input,
        droppedTokens,
        unobservedTokens,
        summarizedTokens,
        compressionRatio: before.totals.input > 0 ? after.totals.input / before.totals.input : 1,
      },
    }];
  });
  const usage = usageSummary(frames);
  const reportTools: AnalysisReport['tools'] = {
    called: tools.called.map((tool) => ({
      ...tool,
      inputTokens: scale(tool.inputTokens),
      resultTokens: scale(tool.resultTokens),
    })),
    mcpServers: tools.mcpServers.map((server) => ({ ...server, resultTokens: scale(server.resultTokens) })),
    loadedNeverCalled: tools.loadedNeverCalled,
    wastedSchemaTokens,
    deferredNeverLoaded: tools.deferredNeverLoaded,
    residentSuspects: tools.residentSuspects,
  };
  const diagnosis = diagnoseSession({
    frames: mappedFrames,
    compactions,
    usage,
    tools: reportTools,
    calibrationSegments,
    anomalyCount: anomalies.length,
  });
  const actionProposals = buildActionProposals(diagnosis.findings, adapter.agentCapabilities);
  return {
    session: {
      id: session.id,
      adapter: session.adapter,
      agent: session.agent,
      title: session.title,
      location: session.location,
      modifiedAt: session.modifiedAt,
      bytes: session.bytes,
    },
    capabilities: adapter.capabilities,
    agentCapabilities: adapter.agentCapabilities,
    exactTotals: frames.every((frame) => frame.providerUsage.source !== 'estimated'),
    calibration,
    calibrationSegments,
    finalTokens: frames.at(-1)?.totals.input ?? 0,
    maxTokens: Math.max(...frames.map((frame) => frame.totals.input)),
    frames: mappedFrames,
    compactions,
    usage,
    diagnosis,
    actionProposals,
    tailBlocks: epilogue.map((block) => mapBlock(block)),
    tools: reportTools,
    residentBreakdown: breakdown,
    anomalies,
  };
}
