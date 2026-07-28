/**
 * Terminal renderer: per-frame stacked bars + session summary.
 *
 * This is the W1 self-verification surface — the numbers here must be
 * eyeball-checkable by someone who knows their own session ("I have 5 MCP
 * servers; is the resident estimate plausible?"). Honesty rules carry over
 * from the contract: exact totals are printed plainly, calibrated estimates
 * are marked, and the unattributed remainder is shown, never hidden.
 */

import type {
  Calibration,
  ContextFrame,
  OriginKind,
  ResidentBreakdown,
  TokenCount,
  ToolsReport,
} from '@tokray/core';

const BAR_WIDTH = 44;

interface Segment {
  key: string;
  label: string;
  color: string;
  tokens: number;
}

const COLORS = {
  resident: '\x1b[35m', // magenta
  system: '\x1b[34m', // blue
  user: '\x1b[32m', // green
  assistant: '\x1b[36m', // cyan
  tool_result: '\x1b[33m', // yellow
  tool_schema: '\x1b[95m', // bright magenta (resident-adjacent)
  summary: '\x1b[37m', // bright-ish white
  unknown: '\x1b[31m', // red
  unattributed: '\x1b[90m', // gray
} as const;

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function kindTokens(frame: ContextFrame, scale: number): Map<OriginKind, number> {
  const map = new Map<OriginKind, number>();
  for (const block of frame.blocks) {
    const k = block.attribution.kind;
    // Prior-priced blocks (tool schemas, images) are shipped constants, not
    // estimator output — the calibration scale does not apply to them.
    const factor = block.tokens.method === 'prior' ? 1 : scale;
    map.set(k, (map.get(k) ?? 0) + block.tokens.value * factor);
  }
  return map;
}

function segmentsFor(frame: ContextFrame, cal: Calibration): Segment[] {
  const truth = frame.totals.input;
  const kinds = kindTokens(frame, cal.scale);
  const segments: Segment[] = [];

  const resident = Math.min(cal.resident.value, truth);
  if (resident > 0) segments.push({ key: 'resident', label: 'resident', color: COLORS.resident, tokens: resident });

  const order: readonly [OriginKind, keyof typeof COLORS][] = [
    ['system', 'system'],
    ['user', 'user'],
    ['assistant', 'assistant'],
    ['tool_result', 'tool_result'],
    ['tool_schema', 'tool_schema'],
    ['summary', 'summary'],
    ['unknown', 'unknown'],
  ];
  for (const [kind, colorKey] of order) {
    const tokens = kinds.get(kind) ?? 0;
    if (tokens > 0) segments.push({ key: kind, label: kind, color: COLORS[colorKey], tokens });
  }

  // Reconcile against the exact total. Positive remainder → unattributed
  // (estimator undershoot + thinking + anything the log does not carry).
  // Negative → estimates overshoot; squeeze proportionally and flag.
  const estimated = segments.reduce((a, s) => a + s.tokens, 0);
  const remainder = truth - estimated;
  if (remainder > 0) {
    segments.push({ key: 'unattributed', label: 'unattributed', color: COLORS.unattributed, tokens: remainder });
  } else if (remainder < 0 && estimated > 0) {
    const squeeze = truth / estimated;
    for (const s of segments) s.tokens *= squeeze;
  }
  return segments;
}

/**
 * Distribute `totalCols` whole columns across segments proportionally to
 * their token share, largest-remainder method. Independent rounding per
 * segment is NOT acceptable here: with up to 8 segments it can overshoot the
 * bar by several columns, and — worse — make a fragmented frame render longer
 * than a bigger single-segment frame. The bar IS the number; it must be
 * monotone in tokens and sum exactly to its target width.
 */
function allocateColumns(segments: readonly Segment[], totalCols: number): number[] {
  const total = segments.reduce((a, s) => a + s.tokens, 0);
  if (total <= 0 || totalCols <= 0) return segments.map(() => 0);

  const ideal = segments.map((s) => (s.tokens / total) * totalCols);
  const cols = ideal.map(Math.floor);
  let remaining = totalCols - cols.reduce((a, b) => a + b, 0);
  const order = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, z) => z.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    cols[i] = (cols[i] ?? 0) + 1;
    remaining--;
  }

  // A nonzero segment must stay visible ("the unattributed remainder is
  // shown, never hidden") — steal a column from the widest segment for any
  // nonzero segment that rounded to zero, while a donor with >1 col exists.
  for (let i = 0; i < segments.length; i++) {
    if ((segments[i]?.tokens ?? 0) <= 0 || (cols[i] ?? 0) > 0) continue;
    let widest = -1;
    for (let j = 0; j < cols.length; j++) {
      if ((cols[j] ?? 0) > (widest === -1 ? 1 : (cols[widest] ?? 0))) widest = j;
    }
    if (widest === -1) break;
    cols[widest] = (cols[widest] ?? 0) - 1;
    cols[i] = 1;
  }
  return cols;
}

export function renderFrame(frame: ContextFrame, cal: Calibration, maxTokens: number, color: boolean): string {
  const truth = frame.totals.input;
  const segments = segmentsFor(frame, cal);
  const totalCols = Math.round((BAR_WIDTH * truth) / Math.max(1, maxTokens));
  const cols = allocateColumns(segments, totalCols);

  let bar = '';
  let usedCols = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const n = cols[i] ?? 0;
    if (n <= 0) continue;
    bar += color ? `${s.color}${'█'.repeat(n)}${RESET}` : '█'.repeat(n);
    usedCols += n;
  }
  if (usedCols === 0 && truth > 0) bar = color ? `${COLORS.unattributed}▏${RESET}` : '▏';

  const seq = String(frame.seq).padStart(4);
  const total = fmtTokens(truth).padStart(6);
  const addedTokens = Math.round(frame.delta.addedTokens * cal.scale);
  const added = addedTokens > 0 ? (color ? ` ${DIM}+${fmtTokens(addedTokens)}${RESET}` : ` +${fmtTokens(addedTokens)}`) : '';
  const hash = color ? `${DIM}#${RESET}` : '#';
  return `${hash}${seq}  ${total}  ${bar}${added}`;
}

export function renderLegend(color: boolean): string {
  const entries = Object.entries(COLORS).map(([key, c]) => (color ? `${c}█${RESET} ${key}` : `█ ${key}`));
  return `  ${entries.join('   ')}`;
}

export interface SessionSummary {
  file: string;
  frames: ContextFrame[];
  cal: Calibration;
  anomalies: number;
  tools: ToolsReport;
  breakdown: ResidentBreakdown;
  /** Summed schema priors of loaded-but-never-called tools (method 'prior'). */
  wastedSchemaTokens: TokenCount;
  exactTotals: boolean;
}

export function renderSummary(s: SessionSummary, color: boolean): string {
  const b = (t: string) => (color ? `${BOLD}${t}${RESET}` : t);
  const dim = (t: string) => (color ? `${DIM}${t}${RESET}` : t);
  const warn = (t: string) => (color ? `\x1b[33m${t}${RESET}` : t);
  const lines: string[] = [];
  const last = s.frames[s.frames.length - 1];
  const scaled = (v: number) => Math.round(v * s.cal.scale);

  lines.push('');
  lines.push(b('── session summary ─────────────────────────────────────────'));
  lines.push(`  frames (model calls)   ${s.frames.length}`);
  if (last) {
    lines.push(
      `  final context size     ${fmtTokens(last.totals.input)} tokens ${dim(
        s.exactTotals ? '(exact, from provider usage)' : '(estimated from complete request content)',
      )}`,
    );
  }

  const band = s.cal.resident.errorBand;
  lines.push(
    `  resident layer         ~${fmtTokens(s.cal.resident.value)} tokens ${dim(
      `(estimated: system prompt + tool defs${band ? `, band ${fmtTokens(band[0])}–${fmtTokens(band[1])}` : ''})`,
    )}`,
  );
  lines.push(`  calibration            scale ×${s.cal.scale.toFixed(2)}, r²=${s.cal.r2.toFixed(3)} over ${s.cal.n} frames`);
  if (s.cal.r2 < 0.8) {
    lines.push(`  ${warn('⚠ low calibration quality — estimates below are rough')}`);
  }

  const { tools } = s;
  if (tools.called.length > 0) {
    lines.push('');
    lines.push(b('  tools (calibrated estimates)'));
    const top = tools.called.slice(0, 8);
    const width = Math.max(...top.map((t) => t.name.length));
    for (const t of top) {
      const calls = t.calls > 0 ? `${t.calls}×` : '—';
      lines.push(
        `    ${t.name.padEnd(width)}  ${calls.padStart(4)}  in ${fmtTokens(scaled(t.inputTokens)).padStart(6)}  results ${fmtTokens(scaled(t.resultTokens)).padStart(6)}`,
      );
    }
    if (tools.called.length > 8) lines.push(dim(`    … ${tools.called.length - 8} more (see --json)`));
  }

  if (tools.mcpServers.length > 0) {
    lines.push('');
    lines.push(b('  mcp servers'));
    const width = Math.max(...tools.mcpServers.map((m) => m.server.length));
    for (const m of tools.mcpServers) {
      const parts =
        m.calls > 0
          ? [
              `${m.calledTools} tool${m.calledTools === 1 ? '' : 's'} called (${m.calls}×)`,
              `results ${fmtTokens(scaled(m.resultTokens))}`,
              m.deferredTools > 0 ? `${m.deferredTools} deferred` : '',
            ]
          : [
              `idle — 0 calls${m.deferredTools > 0 ? ` (${m.deferredTools} tool${m.deferredTools === 1 ? '' : 's'} deferred)` : ''}`,
            ];
      lines.push(`    ${m.server.padEnd(width)}  ${parts.filter(Boolean).join(' · ')}`);
    }
  }

  // NOT nested under everDeferred: `loaded` comes from tool_reference
  // records, which can appear even when the deferral announcement predates
  // the log window — the waste warning must survive that.
  const deferredBits: string[] = [];
  if (tools.everDeferred.length > 0) {
    deferredBits.push(`${tools.deferredNeverLoaded.length} stayed deferred ${dim('(no schema cost — exact)')}`);
  }
  if (tools.loaded.length > 0) deferredBits.push(`${tools.loaded.length} loaded on demand`);
  if (deferredBits.length > 0) {
    lines.push('');
    lines.push(`  deferred tools         ${deferredBits.join(' · ')}`);
  }
  if (tools.loadedNeverCalled.length > 0) {
    lines.push(
      `  ${warn(
        `⚠ loaded but never called: ${tools.loadedNeverCalled.join(', ')} — ~${fmtTokens(s.wastedSchemaTokens.value)} tokens of schema for nothing (prior)`,
      )}`,
    );
  }

  if (s.breakdown.components.length > 0) {
    const bd = s.breakdown;
    let priorSum = 0;
    let bandLo = 0;
    let bandHi = 0;
    for (const c of bd.components) {
      priorSum += c.tokens.value;
      bandLo += c.tokens.errorBand?.[0] ?? c.tokens.value;
      bandHi += c.tokens.errorBand?.[1] ?? c.tokens.value;
    }
    const names = bd.components.map((c) => c.label);
    const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? `, +${names.length - 6} more` : '');
    lines.push('');
    lines.push(b(`  resident breakdown ${dim(`(vs calibrated total ~${fmtTokens(bd.total.value)})`)}`));
    // "inferred", never "observed": these are residency SUSPECTS — called
    // tools with no in-log deferral/materialization evidence.
    lines.push(
      `    resident schemas (inferred)  ~${fmtTokens(priorSum).padStart(6)}  ${dim(
        `(${names.length} called tool${names.length === 1 ? '' : 's'} never seen deferred: ${shown}; priors, band ${fmtTokens(bandLo)}–${fmtTokens(bandHi)})`,
      )}`,
    );
    lines.push(
      `    system prompt + unobserved   ~${fmtTokens(bd.unaccounted.value).padStart(6)}  ${dim('(remainder)')}`,
    );
    if (bd.overshoot) {
      lines.push(`    ${warn('⚠ schema priors alone exceed the calibrated resident — priors overshoot or calibration is off')}`);
    }
  }

  if (s.anomalies > 0) {
    lines.push('');
    lines.push(`  ${warn(`${s.anomalies} unrecognized record(s) — run with --json to inspect redacted samples`)}`);
  }
  lines.push('');
  return lines.join('\n');
}
