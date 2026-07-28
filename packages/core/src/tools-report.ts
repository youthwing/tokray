/**
 * Session-level tool accounting (W2).
 *
 * Two questions, answered at deliberately different confidence levels:
 *
 * 1. What did tool CALLS cost this session? tool_use inputs and tool_result
 *    payloads are in the log; the sums here are raw estimator values, and
 *    callers apply the calibration scale for display like everything else.
 *
 * 2. Which schemas sat in the resident layer, and were they worth it?
 *    The log never carries schemas — only names (ToolRosterDelta). The set
 *    arithmetic below (deferred / loaded / called) is EXACT; pricing a schema
 *    is not, and uses priors that say so (TokenCount method 'prior').
 *    residentBreakdown() reconciles those priors against the calibrated
 *    resident total instead of presenting them as measurements.
 */

import type { Calibration } from './calibrate.js';
import type { ContextBlock, ContextFrame, TokenCount, ToolRosterDelta } from './types.js';

export interface ToolStat {
  name: string;
  /** MCP server, when the name follows the `mcp__<server>__<tool>` convention. */
  server?: string;
  calls: number;
  /** Estimated tokens of tool_use inputs (raw estimator values). */
  inputTokens: number;
  /** Estimated tokens of tool_result payloads (raw estimator values). */
  resultTokens: number;
}

export interface McpServerStat {
  server: string;
  /** Distinct tools of this server that were called. */
  calledTools: number;
  calls: number;
  resultTokens: number;
  /** Distinct tools of this server ever seen in the deferred roster. */
  deferredTools: number;
  /** Whether the server announced itself via an instructions block. */
  announced: boolean;
}

export interface ToolsReport {
  /** Tools observed in tool_use / tool_result blocks, heaviest first. */
  called: readonly ToolStat[];
  /** Names ever seen in the deferred roster. */
  everDeferred: readonly string[];
  /**
   * Names whose schema materialization was WITNESSED in the log
   * (tool_reference records). Not necessarily a subset of everDeferred: the
   * deferral announcement may predate the log window.
   */
  loaded: readonly string[];
  /**
   * Materialized at some point and never called anywhere in this session
   * (name-level, order-insensitive): schema tokens paid for nothing.
   * Exact set arithmetic — only the token price of the waste is a prior.
   */
  loadedNeverCalled: readonly string[];
  /**
   * Seen deferred, never observed materializing, never called: cost
   * ~nothing. Called tools are excluded — a call usually implies the harness
   * materialized the schema, though the log cannot prove it (a direct call to
   * a still-deferred tool fails yet still leaves tool_use records).
   */
  deferredNeverLoaded: readonly string[];
  /**
   * SUSPECTS, not observations: called tools with no in-log evidence of
   * deferral or materialization, so their schema was PLAUSIBLY resident on
   * every call. Inferred — a roster record may predate the log — and the
   * per-name price is a prior. Anything the log shows being materialized
   * (`loaded`) is excluded: witnessed loading is proof of non-residency.
   */
  residentSuspects: readonly string[];
  mcpServers: readonly McpServerStat[];
}

/** `mcp__<server>__<tool>` → server name; undefined for non-MCP names. */
export function mcpServerOf(name: string): string | undefined {
  const m = /^mcp__(.+?)__./.exec(name);
  return m ? m[1] : undefined;
}

export function buildToolsReport(
  frames: readonly ContextFrame[],
  deltas: readonly ToolRosterDelta[],
  /**
   * Timeline blocks that made it into no frame (the log ended before the
   * next model call). Without them, the final turn's tool activity is
   * invisible and a tool loaded-then-called-at-the-end reads as waste.
   */
  epilogue: readonly ContextBlock[] = [],
): ToolsReport {
  // Call/result accounting, deduped by block id: frames snapshot a shared
  // timeline, so every block reappears in all later frames.
  const stats = new Map<string, ToolStat>();
  const seen = new Set<string>();
  const tally = (block: ContextBlock): void => {
    if (seen.has(block.id)) return;
    seen.add(block.id);
    const a = block.attribution;
    // tool_use blocks are attributed kind 'assistant' with source = tool
    // name; plain assistant prose carries no source.
    const isUse = a.kind === 'assistant' && a.source !== undefined;
    const isResult = a.kind === 'tool_result';
    if (!isUse && !isResult) return;
    const name = a.source ?? '(unmatched tool)';
    let s = stats.get(name);
    if (!s) {
      s = { name, calls: 0, inputTokens: 0, resultTokens: 0 };
      const server = mcpServerOf(name);
      if (server !== undefined) s.server = server;
      stats.set(name, s);
    }
    if (isUse) {
      s.calls++;
      s.inputTokens += block.tokens.value;
    } else {
      s.resultTokens += block.tokens.value;
    }
  };
  for (const frame of frames) for (const block of frame.blocks) tally(block);
  for (const block of epilogue) tally(block);

  // Roster reconstruction: union over the deltas. deferredRemoved is
  // accepted by the type for forward-compatibility but deliberately unused
  // here — cost accounting needs EVER-deferred, and a removal neither
  // refunds nor charges tokens.
  const everDeferred = new Set<string>();
  const loaded = new Set<string>();
  const announcedServers = new Set<string>();
  for (const d of deltas) {
    for (const n of d.deferredAdded ?? []) everDeferred.add(n);
    for (const n of d.loaded ?? []) loaded.add(n);
    for (const n of d.mcpServersAdded ?? []) announcedServers.add(n);
  }

  const calledNames = new Set([...stats.values()].filter((s) => s.calls > 0).map((s) => s.name));

  const loadedNeverCalled = [...loaded].filter((n) => !calledNames.has(n)).sort();
  const deferredNeverLoaded = [...everDeferred]
    .filter((n) => !loaded.has(n) && !calledNames.has(n))
    .sort();
  // Witnessed materialization (`loaded`) is direct proof a schema was NOT
  // resident — even when the matching deferredAdded predates the log.
  const residentSuspects = [...calledNames]
    .filter((n) => !everDeferred.has(n) && !loaded.has(n) && n !== '(unmatched tool)')
    .sort();

  // Per-MCP-server rollup. Servers can surface three ways: called tools,
  // deferred roster names, or an instructions announcement — union them all
  // so a configured-but-idle server still shows up (that IS the finding).
  const servers = new Map<string, McpServerStat>();
  const ensure = (server: string): McpServerStat => {
    let s = servers.get(server);
    if (!s) {
      s = { server, calledTools: 0, calls: 0, resultTokens: 0, deferredTools: 0, announced: false };
      servers.set(server, s);
    }
    return s;
  };
  for (const s of stats.values()) {
    if (s.server === undefined) continue;
    const agg = ensure(s.server);
    if (s.calls > 0) agg.calledTools++;
    agg.calls += s.calls;
    agg.resultTokens += s.resultTokens;
  }
  for (const n of everDeferred) {
    const server = mcpServerOf(n);
    if (server !== undefined) ensure(server).deferredTools++;
  }
  for (const server of announcedServers) ensure(server).announced = true;

  return {
    called: [...stats.values()].sort(
      (a, z) => z.inputTokens + z.resultTokens - (a.inputTokens + a.resultTokens),
    ),
    everDeferred: [...everDeferred].sort(),
    loaded: [...loaded].sort(),
    loadedNeverCalled,
    deferredNeverLoaded,
    residentSuspects,
    // Code-unit comparison like every other list here: localeCompare would
    // make output ordering depend on the machine's ICU locale.
    mcpServers: [...servers.values()].sort((a, z) => (a.server < z.server ? -1 : a.server > z.server ? 1 : 0)),
  };
}

// ---------------------------------------------------------------------------
// Resident breakdown: priors reconciled against the calibrated total
// ---------------------------------------------------------------------------

export interface ResidentComponent {
  label: string;
  /** Typically method 'prior' — the schema text never appears in the log. */
  tokens: TokenCount;
}

export interface ResidentBreakdown {
  /** The calibrated resident total this breakdown reconciles against. */
  total: TokenCount;
  components: readonly ResidentComponent[];
  /**
   * total − Σ components, clamped at 0: the base system prompt plus every
   * schema we could not observe (never-called resident tools are invisible).
   */
  unaccounted: TokenCount;
  /** Component priors alone exceed the calibrated total: priors overshoot, or calibration is off. */
  overshoot: boolean;
}

/**
 * Never allocates the measured total across components — that would dress
 * priors up as measurements. Components keep their stated priors; the
 * remainder is reported explicitly, and an overshoot is flagged, not hidden.
 */
export function residentBreakdown(
  cal: Calibration,
  components: readonly ResidentComponent[],
): ResidentBreakdown {
  let sum = 0;
  let sumLo = 0;
  let sumHi = 0;
  for (const c of components) {
    sum += c.tokens.value;
    sumLo += c.tokens.errorBand?.[0] ?? c.tokens.value;
    sumHi += c.tokens.errorBand?.[1] ?? c.tokens.value;
  }
  const total = cal.resident;
  const totalLo = total.errorBand?.[0] ?? total.value;
  const totalHi = total.errorBand?.[1] ?? total.value;
  return {
    total,
    components,
    unaccounted: {
      value: Math.max(0, total.value - sum),
      method: 'calibrated-heuristic',
      errorBand: [Math.max(0, totalLo - sumHi), Math.max(0, totalHi - sumLo)],
    },
    overshoot: sum > total.value,
  };
}
