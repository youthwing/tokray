import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { AnalysisBlock, AnalysisReport, ConversationEntry, LocalSession } from './types.js';

const MAX_CONTENT_CHARS = 12_000;
const CONVERSATION_KINDS = new Set(['user', 'assistant', 'tool_result', 'summary']);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function atPointer(value: unknown, pointer: string | undefined): unknown {
  if (!pointer || pointer === '/') return value;
  let current = value;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else {
      const record = object(current);
      if (!record) return undefined;
      current = record[key];
    }
  }
  return current;
}

function readable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join('\n\n');
  const item = object(value);
  if (!item) return String(value);
  for (const key of ['text', 'input_text', 'output_text']) {
    if (typeof item[key] === 'string') return item[key];
  }
  if (item['type'] === 'image' || item['type'] === 'input_image') return '[image]';
  if (item['type'] === 'tool_reference') return `[tool schema: ${String(item['tool_name'] ?? 'unknown')}]`;
  if (item['type'] === 'tool_use' || item['type'] === 'function_call') {
    const name = String(item['name'] ?? item['tool_name'] ?? 'tool');
    const input = item['input'] ?? item['arguments'] ?? {};
    return `${name}\n${typeof input === 'string' ? input : JSON.stringify(input, null, 2)}`;
  }
  if (item['content'] !== undefined) return readable(item['content']);
  return JSON.stringify(item, null, 2);
}

function claudeContent(record: JsonObject, block: AnalysisBlock): string {
  if (record['type'] === 'attachment') {
    const attachment = object(record['attachment']);
    return readable(attachment?.['content'] ?? attachment?.['addedBlocks'] ?? attachment?.['addedLines']);
  }
  const message = object(record['message']);
  const parts = Array.isArray(message?.['content']) ? message['content'] : undefined;
  if (!parts) return readable(message?.['content']);

  const matches = parts.filter((part) => {
    const item = object(part);
    if (!item) return block.attribution.kind === 'unknown';
    if (block.attribution.kind === 'tool_result') return item['type'] === 'tool_result';
    if (block.attribution.kind === 'tool_schema') {
      const refs = Array.isArray(item['content']) ? item['content'] : [];
      return refs.some((ref) => object(ref)?.['tool_name'] === block.attribution.source);
    }
    if (block.attribution.kind === 'assistant' && block.attribution.source) {
      return item['type'] === 'tool_use' && item['name'] === block.attribution.source;
    }
    return item['type'] === 'text' || item['type'] === 'image';
  });
  return readable(matches.length > 0 ? matches : parts);
}

export function extractBlockContent(record: unknown, block: AnalysisBlock): string {
  const exact = atPointer(record, block.sourceRef.pointer);
  if (block.sourceRef.pointer && exact !== undefined) return readable(exact);
  const value = object(record);
  return value ? claudeContent(value, block) : '';
}

async function readConversationBlocks(
  session: LocalSession & { path: string },
  blocks: readonly AnalysisBlock[],
): Promise<ConversationEntry[]> {
  const conversationBlocks = blocks.filter((block) => CONVERSATION_KINDS.has(block.attribution.kind));
  const needed = new Set(conversationBlocks.map((block) => block.sourceRef.record));
  const records = new Map<number, unknown>();
  const lines = createInterface({ input: createReadStream(session.path), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of lines) {
    lineNo++;
    if (!needed.has(lineNo)) continue;
    try { records.set(lineNo, JSON.parse(line)); } catch { records.set(lineNo, undefined); }
    if (records.size === needed.size) break;
  }

  return conversationBlocks.map((block) => {
    const full = extractBlockContent(records.get(block.sourceRef.record), block) || '[content unavailable]';
    const truncated = full.length > MAX_CONTENT_CHARS;
    return {
      id: block.id,
      kind: block.attribution.kind,
      ...(block.attribution.source ? { source: block.attribution.source } : {}),
      tokens: block.tokens.value,
      record: block.sourceRef.record,
      content: truncated ? `${full.slice(0, MAX_CONTENT_CHARS)}\n\n[truncated]` : full,
      truncated,
    };
  });
}

export async function readFrameConversation(
  session: LocalSession & { path: string },
  report: AnalysisReport,
  seq: number,
): Promise<ConversationEntry[]> {
  const frame = report.frames.find((item) => item.seq === seq);
  if (!frame) throw new Error('Frame not found');
  return readConversationBlocks(session, frame.blocks);
}

export async function readSessionConversation(
  session: LocalSession & { path: string },
  report: AnalysisReport,
): Promise<ConversationEntry[]> {
  const unique = new Map<string, AnalysisBlock>();
  for (const frame of report.frames) for (const block of frame.blocks) unique.set(block.id, block);
  for (const block of report.tailBlocks) unique.set(block.id, block);
  const blocks = [...unique.values()].sort((a, b) => a.sourceRef.record - b.sourceRef.record || a.id.localeCompare(b.id));
  return readConversationBlocks(session, blocks);
}
