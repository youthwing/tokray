import type {
  Anomaly,
  ContextBlock,
  ContextFrame,
  FrameTotals,
  ParseContext,
  ParseEvent,
  ProviderUsage,
} from '@tokray/core';
import { normalizedInputTokens } from '@tokray/core';
import { splitLines } from '../lines.js';
import { redactLine } from '../redact.js';
import { BlockBuilder } from '../sdk.js';

type Obj = Record<string, unknown>;

const object = (value: unknown): Obj | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((part) => {
    const p = object(part);
    if (!p) return JSON.stringify(part);
    if (typeof p['text'] === 'string') return p['text'];
    if (typeof p['content'] === 'string') return p['content'];
    return JSON.stringify(part);
  }).join('\n');
}

function usageOf(provider: string, rec: Obj, response: Obj | undefined): ProviderUsage {
  const usage = object(response?.['usage']) ?? object(rec['usage']);
  if (!usage) return { inputAccounting: 'unknown', source: 'estimated' };
  const anthropic = provider === 'anthropic'
    || 'cache_read_input_tokens' in usage
    || 'cache_creation_input_tokens' in usage;
  const details = object(usage['input_tokens_details']);
  const outputDetails = object(usage['output_tokens_details']);
  const result: ProviderUsage = {
    inputAccounting: anthropic ? 'excludes-cache' : 'includes-cache',
    source: 'api',
  };
  const input = usage['input_tokens'] ?? usage['prompt_tokens'];
  const output = usage['output_tokens'] ?? usage['completion_tokens'];
  if (typeof input === 'number') result.inputTokens = input;
  if (typeof output === 'number') result.outputTokens = output;
  const cacheRead = usage['cache_read_input_tokens'] ?? details?.['cached_tokens'];
  const cacheWrite = usage['cache_creation_input_tokens'];
  const reasoning = usage['reasoning_output_tokens'] ?? outputDetails?.['reasoning_tokens'];
  if (typeof cacheRead === 'number') result.cacheReadTokens = cacheRead;
  if (typeof cacheWrite === 'number') result.cacheWriteTokens = cacheWrite;
  if (typeof reasoning === 'number') result.reasoningOutputTokens = reasoning;
  return result;
}

export async function* parseRawRequest(
  input: AsyncIterable<Uint8Array>,
  ctx: ParseContext,
): AsyncIterable<ParseEvent> {
  const builder = new BlockBuilder(ctx, 'r');
  let seq = 0;
  let bytes = 0;
  for await (const line of splitLines(input)) {
    bytes += line.text.length + 1;
    let rec: Obj;
    try {
      rec = JSON.parse(line.text) as Obj;
    } catch {
      yield { t: 'anomaly', anomaly: { atRecord: line.no, code: 'unparseable', detail: 'JSON.parse failed', redactedSample: redactLine(line.text, 400) } };
      continue;
    }
    const request = object(rec['request']) ?? rec;
    const requestPointer = object(rec['request']) ? '/request' : '';
    const response = object(rec['response']);
    const model = typeof request['model'] === 'string' ? request['model'] : undefined;
    if (!model) {
      const anomaly: Anomaly = { atRecord: line.no, code: 'missing-field', detail: 'request has no model', redactedSample: redactLine(line.text, 400) };
      yield { t: 'anomaly', anomaly };
      continue;
    }

    seq++;
    const provider = typeof rec['provider'] === 'string'
      ? rec['provider']
      : typeof request['provider'] === 'string'
        ? request['provider']
        : ('max_tokens' in request ? 'anthropic' : 'openai');
    const blocks: ContextBlock[] = [];
    const add = (pointer: string, text: string, kind: ContextBlock['attribution']['kind'], source?: string): void => {
      if (text.length === 0) return;
      const attribution: ContextBlock['attribution'] = { kind, confidence: 'exact' };
      if (source !== undefined) attribution.source = source;
      blocks.push(builder.create({ record: line.no, pointer, text, attribution, introducedSeq: seq }));
    };

    const system = request['system'];
    if (system !== undefined) add(`${requestPointer}/system`, textOf(system), 'system');
    for (const [i, tool] of (Array.isArray(request['tools']) ? request['tools'] : []).entries()) {
      const t = object(tool);
      const name = typeof t?.['name'] === 'string'
        ? t['name']
        : typeof object(t?.['function'])?.['name'] === 'string'
          ? object(t?.['function'])!['name'] as string
          : `tool-${i + 1}`;
      add(`${requestPointer}/tools/${i}`, JSON.stringify(tool), 'tool_schema', name);
    }
    const messages = Array.isArray(request['messages'])
      ? request['messages']
      : Array.isArray(request['input'])
        ? request['input']
        : [];
    for (const [i, message] of messages.entries()) {
      const m = object(message);
      if (!m) continue;
      const role = typeof m['role'] === 'string' ? m['role'] : 'unknown';
      const kind = role === 'system' || role === 'developer'
        ? 'system'
        : role === 'user'
          ? 'user'
          : role === 'assistant'
            ? 'assistant'
            : role === 'tool'
              ? 'tool_result'
              : 'unknown';
      const source = typeof m['name'] === 'string' ? m['name'] : undefined;
      add(`${requestPointer}/${Array.isArray(request['messages']) ? 'messages' : 'input'}/${i}/content`, textOf(m['content']), kind, source);
    }

    const providerUsage = usageOf(provider, rec, response);
    if (providerUsage.source === 'estimated') providerUsage.inputTokens = blocks.reduce((sum, block) => sum + block.tokens.value, 0);
    const totals: FrameTotals = { input: normalizedInputTokens(providerUsage) };
    if (providerUsage.cacheReadTokens !== undefined) totals.cacheRead = providerUsage.cacheReadTokens;
    if (providerUsage.cacheWriteTokens !== undefined) totals.cacheWrite = providerUsage.cacheWriteTokens;
    if (providerUsage.outputTokens !== undefined) totals.output = providerUsage.outputTokens;
    const estimated = blocks.reduce((sum, block) => sum + block.tokens.value, 0);
    const frame: ContextFrame = {
      seq,
      at: Date.parse(typeof rec['timestamp'] === 'string' ? rec['timestamp'] : '') || 0,
      model: { provider, model, agent: 'raw-request' },
      blocks,
      usage: builder.usage(blocks, seq),
      providerUsage,
      totals,
      delta: { addedTokens: estimated, carriedTokens: 0, addedBlockIds: blocks.map((block) => block.id) },
    };
    yield { t: 'frame', frame };
  }
  yield { t: 'progress', bytes };
}
