const MAX_INPUT_CHARS = 1_000_000;
const ANSI_ESCAPE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export type NativeFilterProfile = 'auto' | 'generic' | 'test' | 'build' | 'json' | 'git-status';
export type ResolvedNativeFilterProfile = Exclude<NativeFilterProfile, 'auto'>;
export type NativeFilterLossRisk = 'none' | 'low' | 'medium';

export interface NativeFilterMetrics {
  bytes: number;
  lines: number;
  estimatedTokens: number;
}

export interface NativeFilterDecision {
  id:
    | 'strip-ansi'
    | 'collapse-progress-updates'
    | 'collapse-blank-lines'
    | 'deduplicate-consecutive-lines'
    | 'compact-json-whitespace'
    | 'retain-diagnostic-windows'
    | 'omit-low-signal-lines';
  affectedLines: number;
}

export interface NativeFilterResult {
  provider: 'tokray-native';
  requestedProfile: NativeFilterProfile;
  profile: ResolvedNativeFilterProfile;
  command?: string;
  exitCode?: number;
  changed: boolean;
  lossRisk: NativeFilterLossRisk;
  informationPolicy: 'lossless-normalization' | 'repetition-only' | 'selected-lines';
  output: string;
  original: NativeFilterMetrics;
  compact: NativeFilterMetrics;
  removedLines: number;
  estimatedSavedTokens: number;
  outputReductionPercentage: number;
  decisions: readonly NativeFilterDecision[];
  warnings: readonly string[];
  estimate: {
    method: 'bytes/4';
    scope: 'tool-output';
    billingEquivalent: false;
  };
}

export interface NativeFilterOptions {
  profile?: NativeFilterProfile;
  command?: string;
  exitCode?: number;
}

interface NormalizedOutput {
  output: string;
  ansiRemoved: number;
  progressUpdatesRemoved: number;
  blankLinesRemoved: number;
}

interface LineFilterResult {
  lines: string[];
  duplicateLinesRemoved: number;
  omittedLines: number;
  diagnosticWindow: boolean;
}

const FAILURE_LINE = /(?:^|\b)(?:error|errors|failed|failure|fatal|panic|exception|traceback|assertion|expected|received|segmentation fault|denied)(?:\b|:)/i;
const WARNING_LINE = /(?:^|\b)(?:warn|warning|warnings)(?:\b|:)/i;
const SUMMARY_LINE = /(?:tests?|suites?|passed|failed|skipped|duration|time|errors?|warnings?|finished|built|compiled).{0,48}\d|\d.{0,48}(?:tests?|suites?|passed|failed|skipped|errors?|warnings?)/i;
const TEST_SIGNAL = /(?:^|\b)(?:test|tests|suite|suites|pass|passed|fail|failed|assert|expected|received|vitest|jest|pytest|cargo test|surefire)(?:\b|:)/i;
const BUILD_SIGNAL = /(?:^|\b)(?:build|building|built|compile|compiled|compiling|bundle|bundled|transforming|webpack|vite|tsc|maven|gradle)(?:\b|:)/i;
const GIT_STATUS_LINE = /^(?:[ MADRCU?!]{1,2})\s+\S/;

function metrics(output: string): NativeFilterMetrics {
  const bytes = Buffer.byteLength(output, 'utf8');
  return {
    bytes,
    lines: output.length === 0 ? 0 : output.split('\n').length,
    estimatedTokens: Math.ceil(bytes / 4),
  };
}

function normalizeOutput(input: string): NormalizedOutput {
  const ansiMatches = input.match(ANSI_ESCAPE)?.length ?? 0;
  const withoutAnsi = input.replace(ANSI_ESCAPE, '');
  let progressUpdatesRemoved = 0;
  const normalizedLines = withoutAnsi.replace(/\r\n/g, '\n').split('\n').map((line) => {
    if (!line.includes('\r')) return line.trimEnd();
    const updates = line.split('\r');
    progressUpdatesRemoved += Math.max(0, updates.length - 1);
    return (updates.at(-1) ?? '').trimEnd();
  });
  const compactBlanks: string[] = [];
  let blankLinesRemoved = 0;
  for (const line of normalizedLines) {
    if (line.length === 0 && compactBlanks.at(-1) === '') {
      blankLinesRemoved++;
      continue;
    }
    compactBlanks.push(line);
  }
  return {
    output: compactBlanks.join('\n'),
    ansiRemoved: ansiMatches,
    progressUpdatesRemoved,
    blankLinesRemoved,
  };
}

function isJsonDocument(input: string): boolean {
  const trimmed = input.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isJsonLines(input: string): boolean {
  const lines = input.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.every((line) => {
    try {
      JSON.parse(line);
      return line.startsWith('{') || line.startsWith('[');
    } catch {
      return false;
    }
  });
}

/** Remove JSON whitespace outside strings without parsing numeric values into JavaScript numbers. */
function minifyJsonLexically(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (const character of input.trim()) {
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
    } else if (!/\s/.test(character)) {
      output += character;
    }
  }
  return output;
}

function resolveProfile(input: string, requested: NativeFilterProfile, command?: string): ResolvedNativeFilterProfile {
  if (requested !== 'auto') return requested;
  if (isJsonDocument(input) || isJsonLines(input)) return 'json';
  const normalizedCommand = command?.trim().toLowerCase() ?? '';
  if (normalizedCommand.startsWith('git status')) return 'git-status';
  const lines = input.split(/\r?\n/);
  const gitStatusLines = lines.filter((line) => GIT_STATUS_LINE.test(line)).length;
  if (gitStatusLines >= 3 && gitStatusLines >= lines.length * 0.7) return 'git-status';
  const sample = lines.slice(0, 400).join('\n');
  if (TEST_SIGNAL.test(normalizedCommand) || TEST_SIGNAL.test(sample)) return 'test';
  if (BUILD_SIGNAL.test(normalizedCommand) || BUILD_SIGNAL.test(sample)) return 'build';
  return 'generic';
}

function deduplicateConsecutive(lines: readonly string[]): { lines: string[]; removed: number } {
  const output: string[] = [];
  let removed = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    let next = index + 1;
    while (next < lines.length && lines[next] === line && line.length > 0) next++;
    const repetitions = next - index;
    output.push(line);
    if (repetitions > 1) {
      const duplicateCount = repetitions - 1;
      removed += duplicateCount;
      output.push(`[tokray repeated previous line ${duplicateCount} more time${duplicateCount === 1 ? '' : 's'}]`);
    }
    index = next;
  }
  return { lines: output, removed };
}

function diagnosticIndexes(lines: readonly string[], contextRadius: number): Set<number> {
  const indexes = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (!FAILURE_LINE.test(line) && !WARNING_LINE.test(line) && !SUMMARY_LINE.test(line)) continue;
    for (let cursor = Math.max(0, index - contextRadius); cursor <= Math.min(lines.length - 1, index + contextRadius); cursor++) {
      indexes.add(cursor);
    }
  }
  return indexes;
}

function selectedLines(lines: readonly string[], profile: 'test' | 'build' | 'generic'): LineFilterResult {
  const deduplicated = deduplicateConsecutive(lines);
  const source = deduplicated.lines;
  const threshold = profile === 'generic' ? 240 : 32;
  if (source.length <= threshold) {
    return { lines: source, duplicateLinesRemoved: deduplicated.removed, omittedLines: 0, diagnosticWindow: false };
  }
  const keep = diagnosticIndexes(source, 2);
  const head = profile === 'generic' ? 60 : 8;
  const tail = profile === 'generic' ? 60 : 16;
  for (let index = 0; index < Math.min(head, source.length); index++) keep.add(index);
  for (let index = Math.max(0, source.length - tail); index < source.length; index++) keep.add(index);

  const output: string[] = [];
  let omittedLines = 0;
  for (let index = 0; index < source.length;) {
    if (keep.has(index)) {
      output.push(source[index] ?? '');
      index++;
      continue;
    }
    const start = index;
    while (index < source.length && !keep.has(index)) index++;
    const omitted = index - start;
    omittedLines += omitted;
    output.push(`[tokray omitted ${omitted} low-signal line${omitted === 1 ? '' : 's'}]`);
  }
  return {
    lines: output,
    duplicateLinesRemoved: deduplicated.removed,
    omittedLines,
    diagnosticWindow: keep.size > head + tail,
  };
}

export function filterNativeOutput(input: string, options: NativeFilterOptions = {}): NativeFilterResult {
  if (input.length > MAX_INPUT_CHARS) throw new Error('Output exceeds the 1,000,000 character preview limit');
  const requestedProfile = options.profile ?? 'auto';
  const profile = resolveProfile(input, requestedProfile, options.command);
  const normalized = normalizeOutput(input);
  const decisions: NativeFilterDecision[] = [];
  const warnings: string[] = [];
  if (normalized.ansiRemoved > 0) decisions.push({ id: 'strip-ansi', affectedLines: normalized.ansiRemoved });
  if (normalized.progressUpdatesRemoved > 0) decisions.push({ id: 'collapse-progress-updates', affectedLines: normalized.progressUpdatesRemoved });
  if (normalized.blankLinesRemoved > 0) decisions.push({ id: 'collapse-blank-lines', affectedLines: normalized.blankLinesRemoved });
  const normalizationDecisionCount = decisions.length;

  let candidate = normalized.output;
  let lossRisk: NativeFilterLossRisk = 'none';
  let informationPolicy: NativeFilterResult['informationPolicy'] = 'lossless-normalization';
  if (profile === 'json') {
    if (isJsonDocument(normalized.output)) {
      candidate = minifyJsonLexically(normalized.output);
    } else if (isJsonLines(normalized.output)) {
      candidate = normalized.output.split('\n').filter((line) => line.trim().length > 0).map(minifyJsonLexically).join('\n');
    } else {
      warnings.push('requested-json-profile-received-invalid-json');
    }
    if (candidate !== normalized.output) decisions.push({ id: 'compact-json-whitespace', affectedLines: Math.max(1, metrics(normalized.output).lines - metrics(candidate).lines) });
  } else {
    const filtered = profile === 'git-status'
      ? selectedLines(normalized.output.split('\n'), 'generic')
      : selectedLines(normalized.output.split('\n'), profile);
    candidate = filtered.lines.join('\n');
    if (filtered.duplicateLinesRemoved > 0) {
      decisions.push({ id: 'deduplicate-consecutive-lines', affectedLines: filtered.duplicateLinesRemoved });
      lossRisk = 'low';
      informationPolicy = 'repetition-only';
    }
    if (filtered.diagnosticWindow) decisions.push({ id: 'retain-diagnostic-windows', affectedLines: filtered.omittedLines });
    if (filtered.omittedLines > 0) {
      decisions.push({ id: 'omit-low-signal-lines', affectedLines: filtered.omittedLines });
      lossRisk = 'medium';
      informationPolicy = 'selected-lines';
      warnings.push('review-omitted-lines-before-enforcement');
    }
  }

  const original = metrics(input);
  let output = candidate;
  if (metrics(output).bytes > original.bytes) {
    output = normalized.output;
    decisions.splice(normalizationDecisionCount);
    lossRisk = 'none';
    informationPolicy = 'lossless-normalization';
    warnings.push('candidate-was-larger-than-original');
  }
  const compact = metrics(output);
  const changed = output !== input;
  const estimatedSavedTokens = Math.max(0, original.estimatedTokens - compact.estimatedTokens);
  return {
    provider: 'tokray-native',
    requestedProfile,
    profile,
    ...(options.command ? { command: options.command } : {}),
    ...(options.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
    changed,
    lossRisk,
    informationPolicy,
    output,
    original,
    compact,
    removedLines: Math.max(0, original.lines - compact.lines),
    estimatedSavedTokens,
    outputReductionPercentage: original.bytes > 0
      ? Math.max(0, Math.min(100, ((original.bytes - compact.bytes) / original.bytes) * 100))
      : 0,
    decisions,
    warnings,
    estimate: { method: 'bytes/4', scope: 'tool-output', billingEquivalent: false },
  };
}
