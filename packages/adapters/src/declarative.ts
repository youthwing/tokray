import { heuristicTokenEstimator, normalizedInputTokens } from '@tokray/core';
import type {
  Adapter,
  AdapterCapabilities,
  AgentCapabilities,
  CapabilitySupport,
  ContextBlock,
  ContextFrame,
  FrameTotals,
  OriginKind,
  ParseContext,
  ParseEvent,
  ProviderUsage,
  SourceProbe,
} from '@tokray/core';
import { splitLines } from './lines.js';
import { redactLine } from './redact.js';
import { BlockBuilder, defineAdapter } from './sdk.js';

type JsonScalar = string | number | boolean | null;
type Obj = Record<string, unknown>;

export interface DeclarativeMatch {
  pointer: string;
  equals?: JsonScalar;
}

export interface DeclarativeField {
  pointer: string;
  fallback?: string;
}

export interface DeclarativeTimestampField extends DeclarativeField {
  unit?: 'iso' | 'epoch-ms' | 'epoch-seconds';
}

export interface DeclarativeMessagesMapping {
  pointer: string;
  rolePointer?: string;
  contentPointer?: string;
  sourcePointer?: string;
  roleMap?: Readonly<Record<string, OriginKind>>;
}

export interface DeclarativeToolsMapping {
  pointer: string;
  namePointer?: string;
}

export interface DeclarativeUsageMapping {
  inputTokens?: string;
  outputTokens?: string;
  cacheReadTokens?: string;
  cacheWriteTokens?: string;
  reasoningOutputTokens?: string;
  inputAccounting: ProviderUsage['inputAccounting'];
  source?: 'api' | 'log';
}

export interface DeclarativeAdapterDefinition {
  version: 1;
  id: string;
  agent: string;
  schemaRange: string;
  format: 'jsonl';
  capabilities: AdapterCapabilities;
  agentCapabilities: AgentCapabilities;
  detect: {
    all: readonly DeclarativeMatch[];
    nameIncludes?: string;
  };
  frame: {
    when?: DeclarativeMatch;
    timestamp?: DeclarativeTimestampField;
    model: DeclarativeField;
    provider?: DeclarativeField;
    system?: DeclarativeField;
    messages: DeclarativeMessagesMapping;
    tools?: DeclarativeToolsMapping;
    usage?: DeclarativeUsageMapping;
  };
}

export interface DeclarativeDefinitionIssue {
  path: string;
  message: string;
}

const capabilitySupport = new Set<CapabilitySupport>(['full', 'partial', 'none', 'unknown']);
const accountingStrategies = new Set(['exact-request', 'usage-calibrated', 'heuristic-only']);
const compactionStrategies = new Set(['none', 'marker', 'diff']);
const inputAccountingStrategies = new Set<ProviderUsage['inputAccounting']>(['includes-cache', 'excludes-cache', 'unknown']);
const originKinds = new Set<OriginKind>([
  'system',
  'tool_schema',
  'skill',
  'memory',
  'user',
  'file_ref',
  'tool_result',
  'subagent',
  'thinking',
  'assistant',
  'summary',
  'unknown',
]);
const capabilityKeys: ReadonlyArray<keyof AgentCapabilities> = [
  'readLogs',
  'exactUsage',
  'exactRequest',
  'compactionMarkers',
  'preToolHook',
  'rewriteOutput',
  'toolAllowlist',
  'modelRouting',
  'compactionControl',
];

const object = (value: unknown): Obj | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function valueAtPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  let current = value;
  for (const raw of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(raw);
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else {
      const record = object(current);
      if (!record || !(segment in record)) return undefined;
      current = record[segment];
    }
  }
  return current;
}

function scalarMatches(value: unknown, match: DeclarativeMatch): boolean {
  if (value === undefined) return false;
  return match.equals === undefined || Object.is(value, match.equals);
}

function recordMatches(record: unknown, match: DeclarativeMatch): boolean {
  return scalarMatches(valueAtPointer(record, match.pointer), match);
}

function fieldText(record: unknown, field: DeclarativeField | undefined): string | undefined {
  if (!field) return undefined;
  const value = valueAtPointer(record, field.pointer);
  if (typeof value === 'string' && value.length > 0) return value;
  if ((typeof value === 'number' || typeof value === 'boolean') && Number.isFinite(Number(value))) return String(value);
  return field.fallback;
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      const item = object(part);
      if (typeof item?.['text'] === 'string') return item['text'];
      if (typeof item?.['content'] === 'string') return item['content'];
      return JSON.stringify(part);
    }).join('\n');
  }
  return JSON.stringify(value);
}

function timestampOf(record: unknown, field: DeclarativeTimestampField | undefined): number {
  if (!field) return 0;
  const value = valueAtPointer(record, field.pointer);
  if (field.unit === 'epoch-seconds' && typeof value === 'number') return value * 1000;
  if ((field.unit === 'epoch-ms' || field.unit === undefined) && typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
}

function numberAt(record: unknown, pointer: string | undefined): number | undefined {
  if (!pointer) return undefined;
  const value = valueAtPointer(record, pointer);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

const defaultRoleMap: Readonly<Record<string, OriginKind>> = {
  system: 'system',
  developer: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool_result',
  function: 'tool_result',
};

function usageOf(record: unknown, mapping: DeclarativeUsageMapping | undefined): ProviderUsage {
  if (!mapping) return { inputAccounting: 'unknown', source: 'estimated' };
  const result: ProviderUsage = {
    inputAccounting: mapping.inputAccounting,
    source: mapping.source ?? 'log',
  };
  const inputTokens = numberAt(record, mapping.inputTokens);
  const outputTokens = numberAt(record, mapping.outputTokens);
  const cacheReadTokens = numberAt(record, mapping.cacheReadTokens);
  const cacheWriteTokens = numberAt(record, mapping.cacheWriteTokens);
  const reasoningOutputTokens = numberAt(record, mapping.reasoningOutputTokens);
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) result.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) result.cacheWriteTokens = cacheWriteTokens;
  if (reasoningOutputTokens !== undefined) result.reasoningOutputTokens = reasoningOutputTokens;
  if (inputTokens === undefined && cacheReadTokens === undefined && cacheWriteTokens === undefined) {
    result.source = 'estimated';
  }
  return result;
}

function detectDefinition(definition: DeclarativeAdapterDefinition, probe: SourceProbe) {
  if (definition.detect.nameIncludes && !probe.name?.toLocaleLowerCase().includes(definition.detect.nameIncludes.toLocaleLowerCase())) {
    return { match: false, score: 0, note: 'source name did not match' };
  }
  const lines = probe.head.split('\n').filter((line) => line.trim().length > 0).slice(0, 12);
  let parsed = 0;
  let matched = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as unknown;
      parsed++;
      if (definition.detect.all.every((match) => recordMatches(record, match))) matched++;
    } catch {
      // A partial final line is normal during live writes.
    }
  }
  const ratio = parsed > 0 ? matched / parsed : 0;
  return {
    match: matched > 0 && ratio >= 0.5,
    score: 0.7 + ratio * 0.25,
    note: `${matched}/${parsed} records matched declarative signatures`,
  };
}

async function* parseDefinition(
  definition: DeclarativeAdapterDefinition,
  input: AsyncIterable<Uint8Array>,
  ctx: ParseContext,
): AsyncIterable<ParseEvent> {
  const builder = new BlockBuilder(ctx, `${definition.id}:`);
  let seq = 0;
  let bytes = 0;
  for await (const line of splitLines(input)) {
    bytes += line.text.length + 1;
    let record: unknown;
    try {
      record = JSON.parse(line.text) as unknown;
    } catch {
      yield {
        t: 'anomaly',
        anomaly: {
          atRecord: line.no,
          code: 'unparseable',
          detail: 'JSON.parse failed',
          redactedSample: redactLine(line.text, 400),
        },
      };
      continue;
    }
    if (definition.frame.when && !recordMatches(record, definition.frame.when)) continue;
    const model = fieldText(record, definition.frame.model);
    if (!model) {
      yield {
        t: 'anomaly',
        anomaly: {
          atRecord: line.no,
          code: 'missing-field',
          detail: `model mapping ${definition.frame.model.pointer} produced no value`,
          redactedSample: redactLine(line.text, 400),
        },
      };
      continue;
    }

    seq++;
    const blocks: ContextBlock[] = [];
    const add = (pointer: string, value: unknown, kind: OriginKind, source?: string): void => {
      const text = contentText(value);
      if (text.length === 0) return;
      const attribution: ContextBlock['attribution'] = { kind, confidence: 'exact' };
      if (source !== undefined) attribution.source = source;
      blocks.push(builder.create({ record: line.no, pointer, text, attribution, introducedSeq: seq }));
    };

    if (definition.frame.system) {
      add(definition.frame.system.pointer, valueAtPointer(record, definition.frame.system.pointer), 'system');
    }
    const tools = definition.frame.tools;
    const toolValues = tools ? valueAtPointer(record, tools.pointer) : undefined;
    if (tools && Array.isArray(toolValues)) {
      for (const [index, tool] of toolValues.entries()) {
        const nameValue = valueAtPointer(tool, tools.namePointer ?? '/name');
        const name = typeof nameValue === 'string' ? nameValue : `tool-${index + 1}`;
        add(`${tools.pointer}/${index}`, tool, 'tool_schema', name);
      }
    }
    const messages = valueAtPointer(record, definition.frame.messages.pointer);
    if (Array.isArray(messages)) {
      const mapping = definition.frame.messages;
      for (const [index, message] of messages.entries()) {
        const roleValue = valueAtPointer(message, mapping.rolePointer ?? '/role');
        const role = typeof roleValue === 'string' ? roleValue : 'unknown';
        const kind = mapping.roleMap?.[role] ?? defaultRoleMap[role] ?? 'unknown';
        const sourceValue = mapping.sourcePointer ? valueAtPointer(message, mapping.sourcePointer) : undefined;
        const source = typeof sourceValue === 'string' ? sourceValue : undefined;
        const pointer = `${mapping.pointer}/${index}${mapping.contentPointer ?? '/content'}`;
        add(pointer, valueAtPointer(message, mapping.contentPointer ?? '/content'), kind, source);
      }
    }

    const providerUsage = usageOf(record, definition.frame.usage);
    const estimated = blocks.reduce((sum, block) => sum + block.tokens.value, 0);
    if (providerUsage.source === 'estimated') providerUsage.inputTokens = estimated;
    const totals: FrameTotals = { input: normalizedInputTokens(providerUsage) };
    if (providerUsage.cacheReadTokens !== undefined) totals.cacheRead = providerUsage.cacheReadTokens;
    if (providerUsage.cacheWriteTokens !== undefined) totals.cacheWrite = providerUsage.cacheWriteTokens;
    if (providerUsage.outputTokens !== undefined) totals.output = providerUsage.outputTokens;
    const provider = fieldText(record, definition.frame.provider);
    const identity: ContextFrame['model'] = { model, agent: definition.agent };
    if (provider !== undefined) identity.provider = provider;
    yield {
      t: 'frame',
      frame: {
        seq,
        at: timestampOf(record, definition.frame.timestamp),
        model: identity,
        blocks,
        usage: builder.usage(blocks, seq),
        providerUsage,
        totals,
        delta: { addedTokens: estimated, carriedTokens: 0, addedBlockIds: blocks.map((block) => block.id) },
      },
    };
  }
  yield { t: 'progress', bytes };
}

export function validateDeclarativeAdapterDefinition(value: unknown): DeclarativeDefinitionIssue[] {
  const issues: DeclarativeDefinitionIssue[] = [];
  const definition = object(value);
  const requireString = (path: string, candidate: unknown): void => {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) issues.push({ path, message: 'must be a non-empty string' });
  };
  if (definition?.['version'] !== 1) issues.push({ path: '/version', message: 'must equal 1' });
  requireString('/id', definition?.['id']);
  if (typeof definition?.['id'] === 'string' && !/^[a-z0-9][a-z0-9._-]*$/.test(definition['id'])) {
    issues.push({ path: '/id', message: 'must use lowercase letters, digits, dots, underscores, or hyphens' });
  }
  requireString('/agent', definition?.['agent']);
  requireString('/schemaRange', definition?.['schemaRange']);
  if (definition?.['format'] !== 'jsonl') issues.push({ path: '/format', message: 'must equal jsonl' });
  const detect = object(definition?.['detect']);
  if (!Array.isArray(detect?.['all']) || detect['all'].length === 0) {
    issues.push({ path: '/detect/all', message: 'must contain at least one pointer match' });
  } else {
    for (const [index, matchValue] of detect['all'].entries()) {
      requireString(`/detect/all/${index}/pointer`, object(matchValue)?.['pointer']);
    }
  }
  const frame = object(definition?.['frame']);
  requireString('/frame/model/pointer', object(frame?.['model'])?.['pointer']);
  requireString('/frame/messages/pointer', object(frame?.['messages'])?.['pointer']);
  const capabilities = object(definition?.['agentCapabilities']);
  for (const key of capabilityKeys) {
    if (!capabilitySupport.has(capabilities?.[key] as CapabilitySupport)) {
      issues.push({ path: `/agentCapabilities/${key}`, message: 'must be full, partial, none, or unknown' });
    }
  }
  const adapterCapabilities = object(definition?.['capabilities']);
  if (!accountingStrategies.has(adapterCapabilities?.['accounting'] as string)) {
    issues.push({ path: '/capabilities/accounting', message: 'must be exact-request, usage-calibrated, or heuristic-only' });
  }
  for (const key of ['exactSystemPrompt', 'exactToolSchemas', 'exactUsage'] as const) {
    if (typeof adapterCapabilities?.[key] !== 'boolean') issues.push({ path: `/capabilities/${key}`, message: 'must be boolean' });
  }
  if (!compactionStrategies.has(adapterCapabilities?.['compaction'] as string)) {
    issues.push({ path: '/capabilities/compaction', message: 'must be none, marker, or diff' });
  }
  const usage = object(frame?.['usage']);
  if (usage && !inputAccountingStrategies.has(usage['inputAccounting'] as ProviderUsage['inputAccounting'])) {
    issues.push({ path: '/frame/usage/inputAccounting', message: 'must be includes-cache, excludes-cache, or unknown' });
  }
  const roleMap = object(object(frame?.['messages'])?.['roleMap']);
  for (const [role, kind] of Object.entries(roleMap ?? {})) {
    if (!originKinds.has(kind as OriginKind)) issues.push({ path: `/frame/messages/roleMap/${role}`, message: 'is not a valid origin kind' });
  }
  return issues;
}

export function createDeclarativeAdapter(definition: DeclarativeAdapterDefinition): Adapter {
  const issues = validateDeclarativeAdapterDefinition(definition);
  if (issues.length > 0) {
    throw new TypeError(`Invalid declarative adapter: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
  }
  return defineAdapter({
    id: definition.id,
    schemaRange: definition.schemaRange,
    capabilities: definition.capabilities,
    agentCapabilities: definition.agentCapabilities,
    tokenEstimator: heuristicTokenEstimator,
    detect: (probe: SourceProbe) => detectDefinition(definition, probe),
    parse: (input, ctx) => parseDefinition(definition, input, ctx),
  });
}
