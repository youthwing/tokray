import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_CHARS = 4_096;

type JsonObject = Record<string, unknown>;

export type RtkAvailability = 'available' | 'not-installed' | 'wrong-binary' | 'error';

export interface RtkGainPeriod {
  label: string;
  commands: number;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  savingsPercentage: number;
  totalTimeMs: number;
  averageTimeMs: number;
}

export interface RtkGainSnapshot {
  summary: {
    totalCommands: number;
    inputTokens: number;
    outputTokens: number;
    savedTokens: number;
    savingsPercentage: number;
    totalTimeMs: number;
    averageTimeMs: number;
  };
  daily: readonly RtkGainPeriod[];
  weekly: readonly RtkGainPeriod[];
  monthly: readonly RtkGainPeriod[];
  estimate: {
    method: 'bytes/4';
    scope: 'bash-output';
    billingEquivalent: false;
  };
}

export interface RtkIntegrationStatus {
  availability: RtkAvailability;
  platform: NodeJS.Platform;
  installCommand: string;
  executable?: string;
  version?: string;
  issue?: string;
  gain?: RtkGainSnapshot;
}

export interface RtkRewritePreview {
  status: 'ready' | 'unsupported' | 'unavailable' | 'error';
  command: string;
  rewritten?: string;
  executesCommand: false;
  issue?: string;
}

export interface RtkOptions {
  candidates?: readonly string[];
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RtkCommandSafety {
  allowed: boolean;
  level: 'low' | 'blocked';
  command: string;
  executable?: string;
  args?: readonly string[];
  reason?: string;
}

export interface RtkOutputCapture {
  command: string;
  exitCode: number;
  durationMs: number;
  bytes: number;
  lines: number;
  estimatedTokens: number;
  preview: string;
  previewTruncated: boolean;
}

export interface RtkOutputComparison {
  status: 'completed';
  approved: true;
  workingDirectory: string;
  executedCommands: 2;
  original: RtkOutputCapture;
  compact: RtkOutputCapture;
  estimatedSavedTokens: number;
  outputReductionPercentage: number;
  estimate: {
    method: 'bytes/4';
    scope: 'command-output';
    billingEquivalent: false;
  };
  qualityVerification: 'unverified';
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function installCommand(): string {
  if (process.platform === 'darwin') return 'brew install rtk';
  if (process.platform === 'win32') return 'winget install rtk-ai.rtk';
  return 'cargo install --git https://github.com/rtk-ai/rtk';
}

function defaultCandidates(): string[] {
  const executable = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
  const pathCandidates = (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => resolve(directory, executable));
  const home = homedir();
  return [...new Set([
    ...pathCandidates,
    resolve(home, '.local', 'bin', executable),
    resolve(home, '.cargo', 'bin', executable),
    resolve('/opt/homebrew/bin', executable),
    resolve('/usr/local/bin', executable),
  ])];
}

async function locateRtk(candidates = defaultCandidates()): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through deterministic candidates.
    }
  }
  return undefined;
}

async function runRtk(executable: string, args: readonly string[]): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(executable, [...args], {
      encoding: 'utf8',
      env: { ...process.env, RTK_TELEMETRY_DISABLED: '1' },
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: 10_000,
      windowsHide: true,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 2,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
}

function plainCommandTokens(command: string): string[] | undefined {
  if (!/^[A-Za-z0-9_./@:=,+%\-\s]+$/.test(command)) return undefined;
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens : undefined;
}

const SAFE_GIT_SUBCOMMANDS = new Set(['status', 'log', 'show', 'ls-files', 'rev-parse']);
const SAFE_BRANCH_ARGS = new Set(['--show-current', '--list', '--all', '--remotes', '-a', '-r']);
const BLOCKED_GIT_ARGS = new Set(['--ext-diff', '--textconv']);

/** Deliberately narrow allowlist for commands that may be executed twice by a comparison experiment. */
export function inspectRtkCommandSafety(command: string): RtkCommandSafety {
  const normalized = command.trim();
  const tokens = plainCommandTokens(normalized);
  if (!tokens) return { allowed: false, level: 'blocked', command: normalized, reason: 'shell-syntax-not-supported' };
  const [executable, ...args] = tokens;
  if (!executable) return { allowed: false, level: 'blocked', command: normalized, reason: 'empty-command' };
  if (executable === 'pwd' && args.length === 0) return { allowed: true, level: 'low', command: normalized, executable, args };
  if (executable === 'ls') return { allowed: true, level: 'low', command: normalized, executable, args };
  if (executable !== 'git' || args.length === 0) {
    return { allowed: false, level: 'blocked', command: normalized, reason: 'command-not-allowlisted' };
  }
  const [subcommand, ...subcommandArgs] = args;
  if (subcommand === 'branch') {
    const safe = subcommandArgs.every((arg) => SAFE_BRANCH_ARGS.has(arg));
    return safe
      ? { allowed: true, level: 'low', command: normalized, executable, args }
      : { allowed: false, level: 'blocked', command: normalized, reason: 'git-branch-mutation-risk' };
  }
  if (!subcommand || !SAFE_GIT_SUBCOMMANDS.has(subcommand)) {
    return { allowed: false, level: 'blocked', command: normalized, reason: 'git-subcommand-not-allowlisted' };
  }
  if (subcommandArgs.some((arg) => BLOCKED_GIT_ARGS.has(arg))) {
    return { allowed: false, level: 'blocked', command: normalized, reason: 'external-git-filter-risk' };
  }
  return { allowed: true, level: 'low', command: normalized, executable, args };
}

async function captureCommand(
  executable: string,
  args: readonly string[],
  command: string,
  cwd: string,
): Promise<RtkOutputCapture> {
  const startedAt = Date.now();
  let result: ProcessResult;
  try {
    const output = await execFileAsync(executable, [...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        NO_COLOR: '1',
        RTK_TELEMETRY_DISABLED: '1',
      },
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: 10_000,
      windowsHide: true,
    });
    result = { code: 0, stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    result = {
      code: typeof failure.code === 'number' ? failure.code : 2,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
    };
  }
  const combined = result.stderr.length > 0
    ? `${result.stdout}${result.stdout.length > 0 ? '\n' : ''}${result.stderr}`
    : result.stdout;
  const bytes = Buffer.byteLength(combined, 'utf8');
  const previewLimit = 24_000;
  return {
    command,
    exitCode: result.code,
    durationMs: Date.now() - startedAt,
    bytes,
    lines: combined.length === 0 ? 0 : combined.split('\n').length,
    estimatedTokens: Math.ceil(bytes / 4),
    preview: combined.slice(0, previewLimit),
    previewTruncated: combined.length > previewLimit,
  };
}

function period(value: unknown, kind: 'daily' | 'weekly' | 'monthly'): RtkGainPeriod | undefined {
  const item = object(value);
  if (!item) return undefined;
  const label = kind === 'daily'
    ? item['date']
    : kind === 'weekly'
      ? `${String(item['week_start'] ?? '')}..${String(item['week_end'] ?? '')}`
      : item['month'];
  if (typeof label !== 'string' || label.length === 0) return undefined;
  return {
    label,
    commands: number(item['commands']),
    inputTokens: number(item['input_tokens']),
    outputTokens: number(item['output_tokens']),
    savedTokens: number(item['saved_tokens']),
    savingsPercentage: number(item['savings_pct']),
    totalTimeMs: number(item['total_time_ms']),
    averageTimeMs: number(item['avg_time_ms']),
  };
}

export function parseRtkGain(value: unknown): RtkGainSnapshot {
  const root = object(value);
  const summary = object(root?.['summary']);
  if (!root || !summary) throw new Error('RTK gain output has no summary');
  const periods = (kind: 'daily' | 'weekly' | 'monthly') => {
    const values = Array.isArray(root[kind]) ? root[kind] : [];
    return values.map((item) => period(item, kind)).filter((item): item is RtkGainPeriod => item !== undefined).slice(-400);
  };
  return {
    summary: {
      totalCommands: number(summary['total_commands']),
      inputTokens: number(summary['total_input']),
      outputTokens: number(summary['total_output']),
      savedTokens: number(summary['total_saved']),
      savingsPercentage: number(summary['avg_savings_pct']),
      totalTimeMs: number(summary['total_time_ms']),
      averageTimeMs: number(summary['avg_time_ms']),
    },
    daily: periods('daily'),
    weekly: periods('weekly'),
    monthly: periods('monthly'),
    estimate: { method: 'bytes/4', scope: 'bash-output', billingEquivalent: false },
  };
}

export async function inspectRtk(options: RtkOptions = {}): Promise<RtkIntegrationStatus> {
  const executable = await locateRtk(options.candidates ? [...options.candidates] : undefined);
  const base = { platform: process.platform, installCommand: installCommand() };
  if (!executable) return { ...base, availability: 'not-installed' };
  const result = await runRtk(executable, ['--version']);
  if (result.code !== 0) {
    return { ...base, availability: 'error', executable, issue: result.stderr.trim() || 'RTK version check failed' };
  }
  const match = result.stdout.trim().match(/^rtk\s+v?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i);
  if (!match) return { ...base, availability: 'wrong-binary', executable, issue: result.stdout.trim() || 'Unexpected RTK binary' };
  return { ...base, availability: 'available', executable, version: match[1]! };
}

export async function importRtkGain(options: RtkOptions = {}): Promise<RtkIntegrationStatus> {
  const status = await inspectRtk(options);
  if (status.availability !== 'available' || !status.executable) return status;
  const result = await runRtk(status.executable, ['gain', '--all', '--format', 'json']);
  if (result.code !== 0) return { ...status, availability: 'error', issue: result.stderr.trim() || 'RTK gain import failed' };
  try {
    return { ...status, gain: parseRtkGain(JSON.parse(result.stdout)) };
  } catch (error) {
    return { ...status, availability: 'error', issue: error instanceof Error ? error.message : 'Invalid RTK gain JSON' };
  }
}

export async function previewRtkRewrite(command: string, options: RtkOptions = {}): Promise<RtkRewritePreview> {
  const normalized = command.trim();
  if (!normalized || normalized.length > MAX_COMMAND_CHARS || normalized.includes('\0') || normalized.includes('\n')) {
    throw new Error('Command must be one non-empty line up to 4096 characters');
  }
  const status = await inspectRtk(options);
  if (status.availability !== 'available' || !status.executable) {
    return { status: 'unavailable', command: normalized, executesCommand: false, issue: status.issue ?? status.availability };
  }
  const result = await runRtk(status.executable, ['rewrite', normalized]);
  if (result.code === 1) return { status: 'unsupported', command: normalized, executesCommand: false };
  if (result.code !== 0) return { status: 'error', command: normalized, executesCommand: false, issue: result.stderr.trim() || 'RTK rewrite failed' };
  const rewritten = result.stdout.trim();
  if (!rewritten || rewritten === normalized) return { status: 'unsupported', command: normalized, executesCommand: false };
  return { status: 'ready', command: normalized, rewritten, executesCommand: false };
}

export async function compareRtkOutput(
  command: string,
  approval: { approved: true; expectedRewrite: string },
  options: RtkOptions & { cwd?: string } = {},
): Promise<RtkOutputComparison> {
  if (approval.approved !== true) throw new Error('Explicit approval is required');
  const safety = inspectRtkCommandSafety(command);
  if (!safety.allowed || !safety.executable || !safety.args) {
    throw new Error(`Command is not eligible for comparison: ${safety.reason ?? 'blocked'}`);
  }
  const status = await inspectRtk(options);
  if (status.availability !== 'available' || !status.executable) throw new Error(status.issue ?? status.availability);
  const rewrite = await previewRtkRewrite(command, options);
  if (rewrite.status !== 'ready' || !rewrite.rewritten) throw new Error(rewrite.issue ?? rewrite.status);
  if (rewrite.rewritten !== approval.expectedRewrite) throw new Error('RTK rewrite changed after approval; preview it again');
  const rewrittenTokens = plainCommandTokens(rewrite.rewritten);
  if (!rewrittenTokens || basename(rewrittenTokens[0] ?? '').toLowerCase() !== (process.platform === 'win32' ? 'rtk.exe' : 'rtk')) {
    throw new Error('RTK produced a rewrite that requires a shell; comparison was blocked');
  }
  const workingDirectory = resolve(options.cwd ?? process.cwd());
  const original = await captureCommand(safety.executable, safety.args, safety.command, workingDirectory);
  const compact = await captureCommand(status.executable, rewrittenTokens.slice(1), rewrite.rewritten, workingDirectory);
  const estimatedSavedTokens = Math.max(0, original.estimatedTokens - compact.estimatedTokens);
  return {
    status: 'completed',
    approved: true,
    workingDirectory,
    executedCommands: 2,
    original,
    compact,
    estimatedSavedTokens,
    outputReductionPercentage: original.bytes > 0
      ? Math.max(0, Math.min(100, ((original.bytes - compact.bytes) / original.bytes) * 100))
      : 0,
    estimate: { method: 'bytes/4', scope: 'command-output', billingEquivalent: false },
    qualityVerification: 'unverified',
  };
}
