/**
 * Claude Code session-log adapter.
 *
 * Source: ~/.claude/projects/<project>/<session>.jsonl
 *
 * Ground rules established by surveying real logs (2026-07):
 *
 * - One API call is logged as SEVERAL `assistant` records sharing one
 *   `requestId`, and the run may be INTERLEAVED with tool_result (user) and
 *   attachment records when tools execute in parallel. A frame is cut per
 *   requestId run (adjacent-merged), never per record: verified on real
 *   sessions, adjacent merging recovers exactly the distinct-requestId count.
 *   Usage is taken from the last record of the run.
 *
 * - The exact prompt size for a call is
 *   `usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 *
 * - Synthetic records (`model: "<synthetic>"` / `isApiErrorMessage: true`,
 *   all-zero usage — e.g. "Credit balance is too low") are NOT model calls.
 *   They are skipped with an anomaly; emitting them as frames would poison
 *   calibration with (estimate>0, truth=0) points.
 *
 * - The log records MESSAGES, not the request payload: the system prompt and
 *   tool/MCP definitions never appear. That resident layer is recovered by
 *   calibration (core/calibrate.ts) as the regression intercept — which is
 *   exactly why Attribution carries a confidence level.
 *
 * - Images are flat-priced (~1100 tokens), never length-priced: the API
 *   charges roughly (w·h)/750, while base64 length would overshoot ~15-50×.
 *   This applies to tool_result parts AND user-pasted images.
 *
 * - `thinking` blocks are excluded from context estimates: the API strips
 *   prior-turn thinking from subsequent requests. (In-turn tool loops do
 *   re-send the current turn's thinking; accepting that error keeps W1 simple
 *   and it lands inside the reported error band.)
 *
 * - A set of record types is session metadata that never reaches the model
 *   (mode, last-prompt, custom-title, ...). They are skipped silently — a
 *   KNOWN list, so a genuinely new record type still surfaces as an anomaly.
 *
 * - `isSidechain: true` records are parsed normally: main-thread session
 *   files never contain them (verified), while standalone subagent
 *   transcripts consist ENTIRELY of them — skipping would silently produce
 *   zero frames for every subagent file.
 *
 * - Tool availability IS partially in the log (verified 2.1.x):
 *   `deferred_tools_delta` attachments carry the deferred-tool roster by
 *   name; ToolSearch materializations appear as `tool_reference` parts inside
 *   tool_results (the harness expands them to full schemas in the real
 *   payload — the log has only the name, so each materialization becomes its
 *   own `tool_schema` block priced by prior, method 'prior', never mixed into
 *   the estimator-priced result block); `mcp_instructions_delta` attachments
 *   announce MCP servers WITH their instruction text. All three are surfaced
 *   as `roster` events.
 *
 * - Blocks appended after the last frame's snapshot (the log ends mid-turn)
 *   are emitted as one `epilogue` event: no model call ever saw them, so
 *   they stay out of frames and calibration, but session-level tool
 *   accounting would otherwise miss the final turn entirely.
 *
 * - Delta-style attachments (`deferred_tools_delta`, `agent_listing_delta`,
 *   `mcp_instructions_delta`) carry their payload in addedNames/addedLines/
 *   addedBlocks rather than `content` — that text does reach the model as
 *   reminders, so it is estimated from those fields, not skipped.
 */

import type {
  Anomaly,
  Attribution,
  BlockId,
  ContextBlock,
  ContextFrame,
  FrameTotals,
  ParseContext,
  ParseEvent,
  ProviderUsage,
  TokenCount,
  ToolRosterDelta,
} from '@tokray/core';
import { blockFeatures, contentHash, estimateTokens } from '@tokray/core';
import { splitLines } from '../lines.js';
import { redactLine } from '../redact.js';
import { schemaPrior } from './priors.js';

/** Metadata records that never enter model context. Additions are deliberate. */
const IGNORED_RECORD_TYPES: ReadonlySet<string> = new Set([
  'mode',
  'last-prompt',
  'custom-title',
  'ai-title',
  'queue-operation',
  'relocated',
  'file-history-snapshot',
  'permission-mode',
  'frame-link',
  'summary',
  // `system` records (hook summaries, api errors, turn durations) are shown to
  // the user, not sent to the model. Hook-injected context arrives separately
  // as `attachment` records, which ARE parsed below.
  'system',
]);

/**
 * Flat price for one image. The API charges roughly (w·h)/750 tokens;
 * dimensions are not in the log, so a screenshot-sized constant is used and
 * the containing block is flagged `guessed`.
 */
const IMAGE_TOKENS = 1100;
/** Plausible (w·h)/750 range from thumbnail to full-screen capture. */
const IMAGE_BAND: readonly [number, number] = [300, 2200];

interface MutableFrame {
  requestId: string;
  seq: number;
  at: number;
  startRecord: number;
  model: string;
  blocks: ContextBlock[];
  totals: FrameTotals;
  providerUsage: ProviderUsage;
  prevBlockCount: number;
  /** Timeline epoch at snapshot time; a compaction between snapshot and
   * finalize means this frame's bookkeeping belongs to a dead world. */
  epoch: number;
  compactionRef?: number;
}

/**
 * V8's JSON.parse error messages embed an excerpt of the raw input. Anomaly
 * details are shareable by design, so only positional info may survive.
 */
function sanitizeParseError(message: string): string {
  const pos = message.match(/at position \d+(?: \(line \d+ column \d+\))?/);
  return pos ? `JSON.parse failed ${pos[0]}` : 'JSON.parse failed';
}

export async function* parseClaudeCode(
  input: AsyncIterable<Uint8Array>,
  ctx: ParseContext,
): AsyncIterable<ParseEvent> {
  /** Append-only conversation timeline; frames snapshot a prefix of it. */
  const timeline: ContextBlock[] = [];
  /** tool_use_id → human tool name, for tool_result attribution. */
  const toolNames = new Map<string, string>();
  const introducedSeq = new Map<BlockId, number>();

  let seq = 0;
  let pending: MutableFrame | null = null;
  /** Block count of the previously emitted frame; reset on compaction. */
  let lastFrameBlockCount = 0;
  /** Incremented on every timeline reset (compaction). */
  let timelineEpoch = 0;
  let blockCounter = 0;
  let bytes = 0;
  /** Set when a compaction was seen; consumed by the NEXT created frame. */
  let compactionAtSeq: number | undefined;

  const mkBlock = (
    record: number,
    text: string,
    attribution: Attribution,
    // number = a value override that is still estimator-class;
    // TokenCount = full provenance override (priors keep method 'prior').
    tokens?: number | TokenCount,
  ): ContextBlock => {
    const id = `b${++blockCounter}` as BlockId;
    introducedSeq.set(id, seq + 1);
    return {
      id,
      attribution,
      sourceRef: { sourceId: ctx.sourceId, record },
      tokens:
        typeof tokens === 'object'
          ? tokens
          : { value: tokens ?? estimateTokens(text), method: 'calibrated-heuristic' },
      hash: contentHash(text),
      features: blockFeatures(text),
    };
  };

  /**
   * Token weight of a content value (tool_result body, or any part list).
   * Text goes through the estimator; images are flat-priced; tool_reference
   * parts contribute NO weight here — each becomes its own `tool_schema`
   * block at the call site, so prior-priced tokens are never laundered into
   * an estimator-priced block; null/exotic parts degrade to their JSON
   * footprint — never a crash.
   */
  const contentWeight = (
    content: unknown,
  ): { text: string; tokens: number; images: number; toolRefs: string[] } => {
    if (typeof content === 'string')
      return { text: content, tokens: estimateTokens(content), images: 0, toolRefs: [] };
    if (!Array.isArray(content)) {
      const s = JSON.stringify(content ?? '');
      return { text: s, tokens: estimateTokens(s), images: 0, toolRefs: [] };
    }
    let text = '';
    let tokens = 0;
    let images = 0;
    const toolRefs: string[] = [];
    for (const part of content) {
      if (part === null || typeof part !== 'object') {
        const s = JSON.stringify(part);
        text += s;
        tokens += estimateTokens(s);
        continue;
      }
      const p = part as { type?: string; text?: string; tool_name?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') {
        text += p.text;
        tokens += estimateTokens(p.text);
      } else if (p.type === 'image') {
        images++;
        tokens += IMAGE_TOKENS;
        text += '«image»';
      } else if (p.type === 'tool_reference' && typeof p.tool_name === 'string') {
        toolRefs.push(p.tool_name);
      } else {
        const s = JSON.stringify(p);
        text += s;
        tokens += estimateTokens(s);
      }
    }
    return { text, tokens, images, toolRefs };
  };

  const finalize = (): ParseEvent[] => {
    if (!pending) return [];
    const f = pending;
    pending = null;

    // A run that never produced usable usage is not a model call we can
    // account for. Dropping it (loudly) protects calibration from
    // (estimate>0, truth=0) poison points.
    if (f.totals.input <= 0) {
      return [
        {
          t: 'anomaly',
          anomaly: {
            atRecord: f.startRecord,
            code: 'missing-field',
            detail: `assistant run ${f.requestId} has no usable usage; frame dropped`,
            redactedSample: '',
          },
        },
      ];
    }

    let tokens = 0;
    for (const b of f.blocks) tokens += b.tokens.value;
    const added = f.blocks.slice(f.prevBlockCount);
    let addedTokens = 0;
    for (const b of added) addedTokens += b.tokens.value;
    const frame: ContextFrame = {
      seq: f.seq,
      at: f.at,
      model: { provider: 'anthropic', model: f.model, agent: 'claude-code' },
      blocks: f.blocks,
      usage: f.blocks.map((b) => {
        const introduced = introducedSeq.get(b.id) ?? f.seq;
        return { blockId: b.id, introducedSeq: introduced, ageFrames: f.seq - introduced + 1 };
      }),
      providerUsage: f.providerUsage,
      totals: f.totals,
      delta: {
        addedTokens,
        carriedTokens: tokens - addedTokens,
        addedBlockIds: added.map((b) => b.id),
      },
      ...(f.compactionRef !== undefined ? { compactionRef: f.compactionRef } : {}),
    };
    // A pending frame can outlive a compaction (it finalizes only when the
    // NEXT request starts). Its block count describes the pre-compaction
    // timeline; restoring it would mark brand-new post-compaction blocks as
    // "carried". Only same-epoch frames may update the carried-prefix.
    if (f.epoch === timelineEpoch) lastFrameBlockCount = f.blocks.length;
    return [{ t: 'frame', frame }];
  };

  const anomaly = (atRecord: number, code: Anomaly['code'], detail: string, raw: string): ParseEvent => ({
    t: 'anomaly',
    anomaly: { atRecord, code, detail, redactedSample: redactLine(raw, 400) },
  });

  for await (const line of splitLines(input)) {
    bytes += line.text.length + 1;

    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line.text) as Record<string, unknown>;
    } catch (e) {
      yield anomaly(line.no, 'unparseable', sanitizeParseError((e as Error).message), line.text);
      continue;
    }

    const type = typeof rec['type'] === 'string' ? (rec['type'] as string) : undefined;
    if (type === undefined) {
      yield anomaly(line.no, 'missing-field', 'record has no `type` field', line.text);
      continue;
    }
    if (IGNORED_RECORD_TYPES.has(type)) continue;

    if (type === 'user') {
      // NOTE: a user record does NOT finalize the pending frame. Parallel
      // tool execution interleaves tool_results INTO an assistant run;
      // cutting here would split one API call into duplicate frames.

      // Experimental: compaction summaries replace the prior timeline.
      // No real sample was available when this was written; marker detection
      // is best-effort and the fixture suite must gain one before W4.
      if (rec['isCompactSummary'] === true) {
        timeline.length = 0;
        lastFrameBlockCount = 0;
        timelineEpoch++;
        compactionAtSeq = seq;
      }

      const message = rec['message'] as { content?: unknown } | undefined;
      const content = message?.content;
      if (typeof content === 'string') {
        timeline.push(
          mkBlock(line.no, content, {
            kind: rec['isCompactSummary'] === true ? 'summary' : 'user',
            confidence: 'exact',
          }),
        );
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part === null || typeof part !== 'object') {
            yield anomaly(line.no, 'schema-version-drift', `user content part is ${part === null ? 'null' : typeof part}`, line.text);
            continue;
          }
          const p = part as { type?: string; text?: string; content?: unknown; tool_use_id?: string };
          if (p.type === 'text' && typeof p.text === 'string') {
            timeline.push(mkBlock(line.no, p.text, { kind: 'user', confidence: 'exact' }));
          } else if (p.type === 'image') {
            // User-pasted screenshot: flat-priced, same rule as tool images.
            timeline.push(
              mkBlock(
                line.no,
                '«image»',
                {
                  kind: 'user',
                  confidence: 'guessed',
                  evidence: `pasted image counted at a flat ${IMAGE_TOKENS} tokens`,
                },
                { value: IMAGE_TOKENS, method: 'prior', errorBand: IMAGE_BAND },
              ),
            );
          } else if (p.type === 'tool_result') {
            const { text, tokens, images, toolRefs } = contentWeight(p.content);
            const toolName = p.tool_use_id ? toolNames.get(p.tool_use_id) : undefined;
            const attribution: Attribution = {
              kind: 'tool_result',
              confidence: toolName && images === 0 ? 'inferred' : 'guessed',
              evidence: [
                toolName
                  ? `matched tool_use_id to a prior tool_use named ${toolName}`
                  : 'tool_result with no matching tool_use in this log',
                images > 0 ? `${images} image(s) counted at a flat ${IMAGE_TOKENS} tokens each` : '',
              ]
                .filter(Boolean)
                .join('; '),
            };
            if (toolName) attribution.source = toolName;
            // A pure-reference result (ToolSearch) has no text of its own —
            // in the real payload its body IS the schemas, modeled below.
            if (text.length > 0 || toolRefs.length === 0) {
              timeline.push(mkBlock(line.no, text, attribution, tokens));
            }
            for (const ref of toolRefs) {
              timeline.push(
                mkBlock(
                  line.no,
                  `«schema:${ref}»`,
                  {
                    kind: 'tool_schema',
                    source: ref,
                    confidence: 'inferred',
                    evidence:
                      'tool_reference record: schema materialized into context by the harness; text never logged, priced by prior',
                  },
                  schemaPrior(ref),
                ),
              );
            }
            if (toolRefs.length > 0) {
              yield { t: 'roster', delta: { atRecord: line.no, loaded: toolRefs } };
            }
          } else {
            const body = JSON.stringify(p);
            timeline.push(
              mkBlock(line.no, body, {
                kind: 'unknown',
                confidence: 'guessed',
                evidence: `unrecognized user content part type: ${String(p.type)}`,
              }),
            );
          }
        }
      }
      continue;
    }

    if (type === 'attachment') {
      // System-injected context: skill listings, task reminders, hook output.
      const att = rec['attachment'] as
        | {
            type?: string;
            content?: unknown;
            addedNames?: unknown;
            removedNames?: unknown;
            addedBlocks?: unknown;
            addedLines?: unknown;
          }
        | undefined;
      const attType = typeof att?.type === 'string' ? att.type : 'unknown';
      // Malformed payloads (non-array where an array is expected) degrade to
      // an empty list → empty body → no block. Never a crash.
      const strings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

      let body: string;
      if (attType === 'deferred_tools_delta') {
        const added = strings(att?.addedNames);
        const removed = strings(att?.removedNames);
        // The harness renders the roster as a name list in a reminder; the
        // names are what reaches the model.
        body = [...added, ...removed].join('\n');
        if (added.length > 0 || removed.length > 0) {
          const delta: ToolRosterDelta = { atRecord: line.no };
          if (added.length > 0) delta.deferredAdded = added;
          if (removed.length > 0) delta.deferredRemoved = removed;
          yield { t: 'roster', delta };
        }
      } else if (attType === 'mcp_instructions_delta') {
        const added = strings(att?.addedNames);
        // addedBlocks carries the full instruction text the model sees.
        body = strings(att?.addedBlocks).join('\n\n');
        if (added.length > 0) {
          yield { t: 'roster', delta: { atRecord: line.no, mcpServersAdded: added } };
        }
      } else if (attType === 'agent_listing_delta') {
        body = strings(att?.addedLines).join('\n');
      } else {
        body =
          typeof att?.content === 'string' ? att.content : att?.content != null ? JSON.stringify(att.content) : '';
      }
      if (body.length > 0) {
        timeline.push(
          mkBlock(line.no, body, {
            kind: 'system',
            source: `attachment:${attType}`,
            confidence: 'inferred',
            evidence: 'attachment record; injected into context by the harness',
          }),
        );
      }
      continue;
    }

    if (type === 'assistant') {
      const message = rec['message'] as
        | {
            model?: string;
            content?: unknown;
            usage?: {
              input_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
              output_tokens?: number;
            };
          }
        | undefined;

      // Synthetic placeholders are not model calls: no frame, no timeline.
      if (rec['isApiErrorMessage'] === true || message?.model === '<synthetic>') {
        yield anomaly(line.no, 'missing-field', 'synthetic assistant record (no real model call); skipped', line.text);
        continue;
      }

      const requestId = typeof rec['requestId'] === 'string' ? (rec['requestId'] as string) : 'unknown';

      if (!pending || pending.requestId !== requestId) {
        // New API call: snapshot the timeline BEFORE this call's own output.
        for (const ev of finalize()) yield ev;
        seq++;
        pending = {
          requestId,
          seq,
          at: Date.parse(typeof rec['timestamp'] === 'string' ? (rec['timestamp'] as string) : '') || 0,
          startRecord: line.no,
          model: message?.model ?? 'unknown',
          blocks: timeline.slice(),
          totals: { input: 0 },
          providerUsage: { inputAccounting: 'excludes-cache', source: 'log' },
          // Compaction resets the timeline, so the carried prefix can shrink.
          prevBlockCount: Math.min(lastFrameBlockCount, timeline.length),
          epoch: timelineEpoch,
          ...(compactionAtSeq !== undefined ? { compactionRef: compactionAtSeq } : {}),
        };
        compactionAtSeq = undefined;
      }

      const usage = message?.usage;
      if (usage) {
        // Server-side tool use (web search etc.) logs one request with several
        // internal iterations; top-level numbers aggregate them. The context
        // window the model saw is the LAST iteration's, so prefer it.
        const iterations = (usage as { iterations?: (typeof usage)[] }).iterations;
        const u = iterations && iterations.length > 1 ? iterations[iterations.length - 1]! : usage;
        const input =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
        if (input > 0) {
          const totals: FrameTotals = { input };
          if (u.cache_read_input_tokens !== undefined) totals.cacheRead = u.cache_read_input_tokens;
          if (u.cache_creation_input_tokens !== undefined) totals.cacheWrite = u.cache_creation_input_tokens;
          if (u.output_tokens !== undefined) totals.output = u.output_tokens;
          pending.totals = totals;
          const providerUsage: ProviderUsage = {
            inputAccounting: 'excludes-cache',
            source: 'log',
          };
          if (u.input_tokens !== undefined) providerUsage.inputTokens = u.input_tokens;
          if (u.output_tokens !== undefined) providerUsage.outputTokens = u.output_tokens;
          if (u.cache_read_input_tokens !== undefined) providerUsage.cacheReadTokens = u.cache_read_input_tokens;
          if (u.cache_creation_input_tokens !== undefined) providerUsage.cacheWriteTokens = u.cache_creation_input_tokens;
          pending.providerUsage = providerUsage;
        }
      }

      // This call's output joins the timeline for FUTURE frames.
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part === null || typeof part !== 'object') {
            yield anomaly(line.no, 'schema-version-drift', `assistant content part is ${part === null ? 'null' : typeof part}`, line.text);
            continue;
          }
          const p = part as { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown };
          if (p.type === 'text' && typeof p.text === 'string') {
            timeline.push(mkBlock(line.no, p.text, { kind: 'assistant', confidence: 'exact' }));
          } else if (p.type === 'tool_use') {
            if (p.id && p.name) toolNames.set(p.id, p.name);
            const body = `${p.name ?? ''} ${JSON.stringify(p.input ?? {})}`;
            const attribution: Attribution = { kind: 'assistant', confidence: 'exact' };
            if (p.name) attribution.source = p.name;
            timeline.push(mkBlock(line.no, body, attribution));
          } else if (p.type === 'thinking') {
            // Deliberately excluded from context estimates; see header comment.
          } else if (p.type === 'fallback') {
            // Observed in real logs (model_refusal_fallback); no context weight.
          } else {
            yield anomaly(line.no, 'schema-version-drift', `unknown assistant content type: ${String(p.type)}`, line.text);
          }
        }
      }
      continue;
    }

    yield anomaly(line.no, 'unknown-record-type', `record type not in the known set: ${type}`, line.text);
  }

  for (const ev of finalize()) yield ev;
  // Blocks past the last same-epoch frame snapshot were seen by no model
  // call (the log ended mid-turn). Surface them for session-level accounting
  // without polluting frames or calibration.
  const tail = timeline.slice(Math.min(lastFrameBlockCount, timeline.length));
  if (tail.length > 0) yield { t: 'epilogue', blocks: tail };
  yield { t: 'progress', bytes };
}
