import { estimateTokens } from '@tokray/core';
import { filterNativeOutput } from './native-filter.js';
import type { NativeFilterLossRisk, NativeFilterProfile } from './native-filter.js';

type JsonObject = Record<string, unknown>;

export type NativeRequestProvider = 'openai-compatible' | 'anthropic-compatible' | 'unknown';
export type NativeRequestBudgetStatus = 'not-set' | 'within-budget' | 'over-budget';

export interface NativeRequestGovernanceOptions {
  maxInputTokens?: number;
  allowedTools?: readonly string[];
  compactToolDescriptions?: boolean;
  deduplicateTools?: boolean;
  compactToolResults?: boolean;
  toolResultMinChars?: number;
  toolResultProfile?: NativeFilterProfile;
}

export interface NativeRequestEstimate {
  value: number;
  method: 'char-class-v1';
  errorBand: readonly [number, number];
  scope: 'serialized-model-request';
  billingEquivalent: false;
}

export interface NativeRequestMetrics {
  estimatedTokens: NativeRequestEstimate;
  serializedBytes: number;
  toolCount: number;
}

export interface NativeRequestDecision {
  id:
    | 'compact-tool-descriptions'
    | 'compact-tool-results'
    | 'deduplicate-exact-tool-schemas'
    | 'apply-explicit-tool-allowlist'
    | 'enforce-input-budget';
  affectedTools: number;
  affectedFields: number;
}

export interface NativeRequestGovernanceResult {
  provider: 'tokray-native';
  requestProvider: NativeRequestProvider;
  request: JsonObject;
  changed: boolean;
  original: NativeRequestMetrics;
  governed: NativeRequestMetrics;
  estimatedSavedTokens: number;
  reductionPercentage: number;
  budget: {
    status: NativeRequestBudgetStatus;
    sendAllowed: boolean;
    maxInputTokens?: number;
    estimateMethod: 'char-class-v1';
  };
  tools: {
    originalCount: number;
    governedCount: number;
    descriptionsCompacted: number;
    descriptionFieldsCompacted: number;
    exactDuplicatesRemoved: number;
    allowlistRemoved: readonly string[];
    unnamedRetained: number;
  };
  toolResults: {
    inspected: number;
    compacted: number;
    originalBytes: number;
    governedBytes: number;
    estimatedSavedTokens: number;
    highestLossRisk: NativeFilterLossRisk;
  };
  integrity: {
    messageContentPreserved: boolean;
    nonToolMessageContentPreserved: true;
    toolResultContractsPreserved: true;
    retainedToolContractsPreserved: true;
    originalInputUnmodified: true;
  };
  decisions: readonly NativeRequestDecision[];
  warnings: readonly string[];
}

const MAX_REQUEST_CHARS = 2_000_000;

const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const item = object(value);
  if (!item) throw new Error('Request must contain only JSON-compatible values');
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(item)) {
    if (child === undefined) throw new Error(`Request field ${key} is undefined and not JSON-compatible`);
    result[key] = cloneJson(child);
  }
  return result;
}

function serialized(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Request is not JSON-serializable');
  return result;
}

function estimate(serializedRequest: string): NativeRequestEstimate {
  const value = estimateTokens(serializedRequest);
  return {
    value,
    method: 'char-class-v1',
    errorBand: [Math.max(0, Math.round(value * 0.6)), Math.round(value * 1.6)],
    scope: 'serialized-model-request',
    billingEquivalent: false,
  };
}

function metrics(request: JsonObject): NativeRequestMetrics {
  const text = serialized(request);
  return {
    estimatedTokens: estimate(text),
    serializedBytes: Buffer.byteLength(text, 'utf8'),
    toolCount: Array.isArray(request['tools']) ? request['tools'].length : 0,
  };
}

const PROTECTED_SEGMENT = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/\S+|(?:^|\s)(?:\.{0,2}[\/\\])?[A-Za-z0-9_.-]+(?:[\/\\][A-Za-z0-9_.-]+)+|\$\{?[A-Z_][A-Z0-9_]*\}?|%[A-Z_][A-Z0-9_]*%|\{[A-Za-z_][A-Za-z0-9_.-]*\}|<[A-Za-z_][A-Za-z0-9_.-]*>/g;

function compactDescription(input: string): string {
  if (input.length < 24) return input;
  const protectedSegments: string[] = [];
  let working = input.replace(PROTECTED_SEGMENT, (segment) => {
    const index = protectedSegments.push(segment) - 1;
    return `\uE000${index}\uE001`;
  });
  working = working
    .replace(/\b(?:please|kindly|certainly|sure|of course|thank you|thanks)\b[,.]?\s*/gi, '')
    .replace(/\b(?:just|really|basically|actually|simply|essentially|generally|literally)\b\s*/gi, '')
    .replace(/\b(?:you can|you should|you may|we can|we will|i will|i can|let me)\b\s*/gi, '')
    .replace(/\b(?:in order to)\b/gi, 'to')
    .replace(/\b(?:make sure to)\b/gi, '')
    .replace(/\b(?:is responsible for)\b/gi, 'handles')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  working = working.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => protectedSegments[Number(index)] ?? '');
  return working.length < input.length ? working : input;
}

function toolName(tool: unknown): string | undefined {
  const item = object(tool);
  if (!item) return undefined;
  if (typeof item['name'] === 'string' && item['name'].trim()) return item['name'];
  const fn = object(item['function']);
  return typeof fn?.['name'] === 'string' && fn['name'].trim() ? fn['name'] : undefined;
}

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  const item = object(value);
  if (!item) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(item)) {
    if (key !== 'description') result[key] = withoutDescriptions(child);
  }
  return result;
}

function compactDescriptions(value: unknown): { value: unknown; changedFields: number } {
  if (Array.isArray(value)) {
    let changedFields = 0;
    const result = value.map((child) => {
      const compacted = compactDescriptions(child);
      changedFields += compacted.changedFields;
      return compacted.value;
    });
    return { value: result, changedFields };
  }
  const item = object(value);
  if (!item) return { value, changedFields: 0 };
  const result: JsonObject = {};
  let changedFields = 0;
  for (const [key, child] of Object.entries(item)) {
    if (key === 'description' && typeof child === 'string') {
      const compacted = compactDescription(child);
      result[key] = compacted;
      if (compacted !== child) changedFields++;
      continue;
    }
    const compacted = compactDescriptions(child);
    result[key] = compacted.value;
    changedFields += compacted.changedFields;
  }
  return { value: result, changedFields };
}

function requestTarget(root: JsonObject): JsonObject {
  return object(root['request']) ?? root;
}

function requestProvider(request: JsonObject): NativeRequestProvider {
  const tools = Array.isArray(request['tools']) ? request['tools'] : [];
  if ('max_tokens' in request || tools.some((tool) => object(tool)?.['input_schema'] !== undefined)) {
    return 'anthropic-compatible';
  }
  if (tools.some((tool) => object(tool)?.['function'] !== undefined)
    || Array.isArray(request['messages'])
    || Array.isArray(request['input'])) {
    return 'openai-compatible';
  }
  return 'unknown';
}

function preservedMessageFields(request: JsonObject): string {
  return serialized({
    ...(request['system'] !== undefined ? { system: request['system'] } : {}),
    ...(request['messages'] !== undefined ? { messages: request['messages'] } : {}),
    ...(request['input'] !== undefined ? { input: request['input'] } : {}),
  });
}

interface ToolResultCompaction {
  inspected: number;
  compacted: number;
  originalBytes: number;
  governedBytes: number;
  estimatedSavedTokens: number;
  highestLossRisk: NativeFilterLossRisk;
}

function riskRank(risk: NativeFilterLossRisk): number {
  return risk === 'medium' ? 2 : risk === 'low' ? 1 : 0;
}

function compactToolResultText(
  value: string,
  options: Required<Pick<NativeRequestGovernanceOptions, 'toolResultMinChars' | 'toolResultProfile'>>,
  result: ToolResultCompaction,
): string {
  result.inspected++;
  const originalBytes = Buffer.byteLength(value, 'utf8');
  result.originalBytes += originalBytes;
  if (value.length < options.toolResultMinChars) {
    result.governedBytes += originalBytes;
    return value;
  }
  const filtered = filterNativeOutput(value, { profile: options.toolResultProfile });
  const compactBytes = Buffer.byteLength(filtered.output, 'utf8');
  if (!filtered.changed || compactBytes >= originalBytes) {
    result.governedBytes += originalBytes;
    return value;
  }
  result.compacted++;
  result.governedBytes += compactBytes;
  result.estimatedSavedTokens += filtered.estimatedSavedTokens;
  if (riskRank(filtered.lossRisk) > riskRank(result.highestLossRisk)) result.highestLossRisk = filtered.lossRisk;
  return filtered.output;
}

function compactTextBlocks(
  value: unknown,
  options: Required<Pick<NativeRequestGovernanceOptions, 'toolResultMinChars' | 'toolResultProfile'>>,
  result: ToolResultCompaction,
): unknown {
  if (typeof value === 'string') return compactToolResultText(value, options, result);
  if (!Array.isArray(value)) return value;
  return value.map((block) => {
    if (typeof block === 'string') return compactToolResultText(block, options, result);
    const item = object(block);
    if (!item || typeof item['text'] !== 'string') return block;
    const type = item['type'];
    if (type !== undefined && type !== 'text' && type !== 'input_text' && type !== 'output_text') return block;
    return { ...item, text: compactToolResultText(item['text'], options, result) };
  });
}

/** Mutates only documented model-facing tool-result text shapes on an already-cloned request. */
function compactToolResults(
  request: JsonObject,
  options: Required<Pick<NativeRequestGovernanceOptions, 'toolResultMinChars' | 'toolResultProfile'>>,
): ToolResultCompaction {
  const result: ToolResultCompaction = {
    inspected: 0,
    compacted: 0,
    originalBytes: 0,
    governedBytes: 0,
    estimatedSavedTokens: 0,
    highestLossRisk: 'none',
  };
  const messages = request['messages'];
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const item = object(message);
      if (!item) continue;
      if (item['role'] === 'tool') {
        item['content'] = compactTextBlocks(item['content'], options, result);
        continue;
      }
      if (!Array.isArray(item['content'])) continue;
      item['content'] = item['content'].map((block) => {
        const content = object(block);
        if (!content || content['type'] !== 'tool_result') return block;
        return { ...content, content: compactTextBlocks(content['content'], options, result) };
      });
    }
  }
  const input = request['input'];
  if (Array.isArray(input)) {
    request['input'] = input.map((entry) => {
      const item = object(entry);
      if (!item || item['type'] !== 'function_call_output') return entry;
      return { ...item, output: compactTextBlocks(item['output'], options, result) };
    });
  }
  return result;
}

export function governNativeRequest(
  input: JsonObject,
  options: NativeRequestGovernanceOptions = {},
): NativeRequestGovernanceResult {
  const inputText = serialized(input);
  if (inputText.length > MAX_REQUEST_CHARS) throw new Error('Request exceeds the 2,000,000 character governance limit');
  if (options.maxInputTokens !== undefined
    && (!Number.isInteger(options.maxInputTokens) || options.maxInputTokens <= 0)) {
    throw new Error('maxInputTokens must be a positive integer');
  }
  if (options.toolResultMinChars !== undefined
    && (!Number.isInteger(options.toolResultMinChars) || options.toolResultMinChars <= 0)) {
    throw new Error('toolResultMinChars must be a positive integer');
  }

  const originalRoot = input;
  const originalRequest = requestTarget(originalRoot);
  const clonedRoot = object(cloneJson(input));
  if (!clonedRoot) throw new Error('Request must be a JSON object');
  const governedRequest = requestTarget(clonedRoot);
  const originalTools = Array.isArray(originalRequest['tools']) ? originalRequest['tools'] : [];
  const clonedTools = Array.isArray(governedRequest['tools']) ? governedRequest['tools'] : [];
  const allowedTools = options.allowedTools === undefined
    ? undefined
    : new Set(options.allowedTools.map((name) => name.trim()).filter(Boolean));
  const compactToolDescriptions = options.compactToolDescriptions !== false;
  const deduplicateTools = options.deduplicateTools !== false;
  const seenExact = new Set<string>();
  const nextTools: unknown[] = [];
  const allowlistRemoved: string[] = [];
  let exactDuplicatesRemoved = 0;
  let descriptionsCompacted = 0;
  let descriptionFieldsCompacted = 0;
  let unnamedRetained = 0;

  for (let index = 0; index < clonedTools.length; index++) {
    const originalTool = originalTools[index];
    const clonedTool = clonedTools[index];
    const name = toolName(clonedTool);
    if (allowedTools && name && !allowedTools.has(name)) {
      allowlistRemoved.push(name);
      continue;
    }
    if (allowedTools && !name) unnamedRetained++;
    const exactKey = serialized(originalTool);
    if (deduplicateTools && seenExact.has(exactKey)) {
      exactDuplicatesRemoved++;
      continue;
    }
    seenExact.add(exactKey);
    const compacted = compactToolDescriptions
      ? compactDescriptions(clonedTool)
      : { value: clonedTool, changedFields: 0 };
    if (serialized(withoutDescriptions(originalTool)) !== serialized(withoutDescriptions(compacted.value))) {
      throw new Error(`Tool contract changed during governance at index ${index}`);
    }
    if (compacted.changedFields > 0) descriptionsCompacted++;
    descriptionFieldsCompacted += compacted.changedFields;
    nextTools.push(compacted.value);
  }
  if (Array.isArray(governedRequest['tools'])) governedRequest['tools'] = nextTools;

  const toolResultOptions = {
    toolResultMinChars: options.toolResultMinChars ?? 2_000,
    toolResultProfile: options.toolResultProfile ?? 'auto',
  };
  const toolResults = options.compactToolResults === true
    ? compactToolResults(governedRequest, toolResultOptions)
    : {
      inspected: 0,
      compacted: 0,
      originalBytes: 0,
      governedBytes: 0,
      estimatedSavedTokens: 0,
      highestLossRisk: 'none' as const,
    };

  const expectedMessages = object(cloneJson(originalRequest));
  if (!expectedMessages) throw new Error('Request must be a JSON object');
  if (options.compactToolResults === true) compactToolResults(expectedMessages, toolResultOptions);
  if (preservedMessageFields(expectedMessages) !== preservedMessageFields(governedRequest)) {
    throw new Error('Message content changed during request governance');
  }

  const originalMetrics = metrics(originalRequest);
  const governedMetrics = metrics(governedRequest);
  const estimatedSavedTokens = Math.max(0, originalMetrics.estimatedTokens.value - governedMetrics.estimatedTokens.value);
  const maxInputTokens = options.maxInputTokens;
  const budgetStatus: NativeRequestBudgetStatus = maxInputTokens === undefined
    ? 'not-set'
    : governedMetrics.estimatedTokens.value <= maxInputTokens
      ? 'within-budget'
      : 'over-budget';
  const decisions: NativeRequestDecision[] = [];
  if (descriptionFieldsCompacted > 0) {
    decisions.push({
      id: 'compact-tool-descriptions',
      affectedTools: descriptionsCompacted,
      affectedFields: descriptionFieldsCompacted,
    });
  }
  if (toolResults.compacted > 0) {
    decisions.push({ id: 'compact-tool-results', affectedTools: toolResults.compacted, affectedFields: toolResults.compacted });
  }
  if (exactDuplicatesRemoved > 0) {
    decisions.push({ id: 'deduplicate-exact-tool-schemas', affectedTools: exactDuplicatesRemoved, affectedFields: 0 });
  }
  if (allowedTools !== undefined) {
    decisions.push({ id: 'apply-explicit-tool-allowlist', affectedTools: allowlistRemoved.length, affectedFields: 0 });
  }
  if (maxInputTokens !== undefined) {
    decisions.push({ id: 'enforce-input-budget', affectedTools: 0, affectedFields: 0 });
  }
  const warnings: string[] = ['token-budget-uses-char-class-estimate'];
  if (unnamedRetained > 0) warnings.push('unnamed-tools-retained-outside-allowlist');
  if (budgetStatus === 'over-budget') warnings.push('request-blocked-by-estimated-input-budget');
  if (toolResults.highestLossRisk !== 'none') warnings.push('tool-result-content-compacted-with-information-loss-risk');

  return {
    provider: 'tokray-native',
    requestProvider: requestProvider(originalRequest),
    request: clonedRoot,
    changed: serialized(originalRoot) !== serialized(clonedRoot),
    original: originalMetrics,
    governed: governedMetrics,
    estimatedSavedTokens,
    reductionPercentage: originalMetrics.estimatedTokens.value > 0
      ? (estimatedSavedTokens / originalMetrics.estimatedTokens.value) * 100
      : 0,
    budget: {
      status: budgetStatus,
      sendAllowed: budgetStatus !== 'over-budget',
      ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
      estimateMethod: 'char-class-v1',
    },
    tools: {
      originalCount: originalTools.length,
      governedCount: nextTools.length,
      descriptionsCompacted,
      descriptionFieldsCompacted,
      exactDuplicatesRemoved,
      allowlistRemoved,
      unnamedRetained,
    },
    toolResults,
    integrity: {
      messageContentPreserved: toolResults.compacted === 0,
      nonToolMessageContentPreserved: true,
      toolResultContractsPreserved: true,
      retainedToolContractsPreserved: true,
      originalInputUnmodified: true,
    },
    decisions,
    warnings,
  };
}
