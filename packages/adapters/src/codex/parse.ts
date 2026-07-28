import type {
  Attribution,
  ContextBlock,
  ContextFrame,
  FrameTotals,
  ParseContext,
  ParseEvent,
  ProviderUsage,
} from '@tokray/core';
import { splitLines } from '../lines.js';
import { redactLine } from '../redact.js';
import { BlockBuilder } from '../sdk.js';

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return value == null ? '' : JSON.stringify(value);
  return value.map((part) => {
    const p = object(part);
    if (typeof p?.['text'] === 'string') return p['text'];
    return p ? JSON.stringify(p) : JSON.stringify(part);
  }).join('\n');
}

export async function* parseCodex(
  input: AsyncIterable<Uint8Array>,
  ctx: ParseContext,
): AsyncIterable<ParseEvent> {
  const builder = new BlockBuilder(ctx, 'c');
  const timeline: ContextBlock[] = [];
  const residentBlockIds = new Set<string>();
  const toolNames = new Map<string, string>();
  let seq = 0;
  let bytes = 0;
  let model = 'unknown';
  let snapshot: ContextBlock[] | undefined;
  let snapshotAt = 0;
  let lastFrameIds = new Set<string>();
  let compactionRef: number | undefined;
  let sawSessionMeta = false;

  const add = (
    record: number,
    pointer: string,
    text: string,
    attribution: Attribution,
  ): ContextBlock | undefined => {
    if (text.length === 0) return undefined;
    const block = builder.create({ record, pointer, text, attribution, introducedSeq: seq + 1 });
    timeline.push(block);
    return block;
  };

  for await (const line of splitLines(input)) {
    bytes += line.text.length + 1;
    let rec: Obj;
    try {
      rec = JSON.parse(line.text) as Obj;
    } catch {
      yield { t: 'anomaly', anomaly: { atRecord: line.no, code: 'unparseable', detail: 'JSON.parse failed', redactedSample: redactLine(line.text, 400) } };
      continue;
    }
    const type = rec['type'];
    const payload = object(rec['payload']);

    if (type === 'session_meta') {
      if (!sawSessionMeta && payload) {
        sawSessionMeta = true;
        const provider = typeof payload['model_provider'] === 'string' ? payload['model_provider'] : undefined;
        const base = payload['base_instructions'];
        if (Array.isArray(base)) {
          for (const [i, item] of base.entries()) {
            const block = add(line.no, `/payload/base_instructions/${i}`, contentText(item), {
              kind: 'system', confidence: 'exact', ...(provider ? { source: provider } : {}),
            });
            if (block) residentBlockIds.add(block.id);
          }
        } else if (base !== undefined) {
          const block = add(line.no, '/payload/base_instructions', contentText(base), { kind: 'system', confidence: 'exact' });
          if (block) residentBlockIds.add(block.id);
        }
        const tools = Array.isArray(payload['dynamic_tools']) ? payload['dynamic_tools'] : [];
        for (const [i, tool] of tools.entries()) {
          const t = object(tool);
          const name = typeof t?.['name'] === 'string' ? t['name'] : `dynamic-tool-${i + 1}`;
          const block = add(line.no, `/payload/dynamic_tools/${i}`, JSON.stringify(tool), {
            kind: 'tool_schema', source: name, confidence: 'exact',
          });
          if (block) residentBlockIds.add(block.id);
        }
      }
      continue;
    }

    if (type === 'turn_context') {
      if (typeof payload?.['model'] === 'string') model = payload['model'];
      continue;
    }

    if (type === 'response_item' && payload) {
      const itemType = payload['type'];
      if (itemType === 'message') {
        const role = typeof payload['role'] === 'string' ? payload['role'] : 'unknown';
        const text = contentText(payload['content']);
        if (role === 'assistant') {
          snapshot ??= timeline.slice();
          snapshotAt ||= Date.parse(typeof rec['timestamp'] === 'string' ? rec['timestamp'] : '') || 0;
          add(line.no, '/payload/content', text, { kind: 'assistant', confidence: 'exact' });
        } else {
          const kind = role === 'user' ? 'user' : role === 'developer' || role === 'system' ? 'system' : 'unknown';
          add(line.no, '/payload/content', text, { kind, confidence: 'exact', source: role });
        }
      } else if (itemType === 'function_call' || itemType === 'custom_tool_call') {
        snapshot ??= timeline.slice();
        snapshotAt ||= Date.parse(typeof rec['timestamp'] === 'string' ? rec['timestamp'] : '') || 0;
        const name = typeof payload['name'] === 'string' ? payload['name'] : '(unknown tool)';
        const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : undefined;
        if (callId) toolNames.set(callId, name);
        const body = payload['arguments'] ?? payload['input'] ?? {};
        add(line.no, `/payload/${itemType === 'function_call' ? 'arguments' : 'input'}`, `${name} ${typeof body === 'string' ? body : JSON.stringify(body)}`, {
          kind: 'assistant', source: name, confidence: 'exact',
        });
      } else if (itemType === 'function_call_output' || itemType === 'custom_tool_call_output') {
        const callId = typeof payload['call_id'] === 'string' ? payload['call_id'] : undefined;
        const name = callId ? toolNames.get(callId) : undefined;
        const attribution: Attribution = {
          kind: 'tool_result',
          confidence: name ? 'inferred' : 'guessed',
          evidence: name ? `matched call_id to ${name}` : 'tool output without a matching call in this log',
        };
        if (name) attribution.source = name;
        add(line.no, '/payload/output', contentText(payload['output']), attribution);
      }
      // Reasoning items are not re-sent verbatim and remain excluded.
      continue;
    }

    if (type === 'event_msg' && payload) {
      const eventType = payload['type'];
      if (eventType === 'context_compacted' || eventType === 'compacted') {
        const resident = timeline.filter((block) => residentBlockIds.has(block.id));
        timeline.length = 0;
        timeline.push(...resident);
        lastFrameIds = new Set();
        compactionRef = seq;
        const summary = payload['summary'] ?? payload['content'];
        if (summary !== undefined) add(line.no, '/payload/summary', contentText(summary), { kind: 'summary', confidence: 'exact' });
        continue;
      }
      if (eventType !== 'token_count') continue;
      const info = object(payload['info']);
      const usage = object(info?.['last_token_usage']);
      const inputTokens = typeof usage?.['input_tokens'] === 'number' ? usage['input_tokens'] : 0;
      if (inputTokens <= 0) continue;

      seq++;
      const blocks = snapshot ?? timeline.slice();
      const providerUsage: ProviderUsage = { inputTokens, inputAccounting: 'includes-cache', source: 'log' };
      if (typeof usage?.['output_tokens'] === 'number') providerUsage.outputTokens = usage['output_tokens'];
      if (typeof usage?.['cached_input_tokens'] === 'number') providerUsage.cacheReadTokens = usage['cached_input_tokens'];
      if (typeof usage?.['cache_write_input_tokens'] === 'number') providerUsage.cacheWriteTokens = usage['cache_write_input_tokens'];
      if (typeof usage?.['reasoning_output_tokens'] === 'number') providerUsage.reasoningOutputTokens = usage['reasoning_output_tokens'];
      const totals: FrameTotals = { input: inputTokens };
      if (providerUsage.cacheReadTokens !== undefined) totals.cacheRead = providerUsage.cacheReadTokens;
      if (providerUsage.cacheWriteTokens !== undefined) totals.cacheWrite = providerUsage.cacheWriteTokens;
      if (providerUsage.outputTokens !== undefined) totals.output = providerUsage.outputTokens;
      const added = blocks.filter((block) => !lastFrameIds.has(block.id));
      const carried = blocks.filter((block) => lastFrameIds.has(block.id));
      const frame: ContextFrame = {
        seq,
        at: snapshotAt || Date.parse(typeof rec['timestamp'] === 'string' ? rec['timestamp'] : '') || 0,
        model: { provider: 'openai', model, agent: 'codex' },
        blocks,
        usage: builder.usage(blocks, seq),
        providerUsage,
        totals,
        delta: {
          addedTokens: added.reduce((sum, block) => sum + block.tokens.value, 0),
          carriedTokens: carried.reduce((sum, block) => sum + block.tokens.value, 0),
          addedBlockIds: added.map((block) => block.id),
        },
        ...(compactionRef !== undefined ? { compactionRef } : {}),
      };
      compactionRef = undefined;
      lastFrameIds = new Set(blocks.map((block) => block.id));
      snapshot = undefined;
      snapshotAt = 0;
      yield { t: 'frame', frame };
      continue;
    }

    // world_state and other top-level rollout metadata do not enter context.
  }

  const tail = timeline.filter((block) => !lastFrameIds.has(block.id));
  if (tail.length > 0) yield { t: 'epilogue', blocks: tail };
  yield { t: 'progress', bytes };
}
