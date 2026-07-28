import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ActionReceipt, JsonValue } from '@tokray/core';
import { filterNativeOutput } from './native-filter.js';
import type { NativeFilterOptions, NativeFilterResult } from './native-filter.js';
import { inspectRtk, previewRtkRewrite } from './rtk.js';
import type { RtkOptions } from './rtk.js';
import {
  createActionReceipt,
  listActionReceipts,
  readStoredActionReceipt,
} from './receipts.js';
import type { ActionReceiptStoreOptions } from './receipts.js';

export type HookBridgeAgent = 'claude-code' | 'codex' | 'codebuddy' | 'trae';
export type HookBridgeProvider = 'tokray-native' | 'rtk';

export interface HookBridgeDefinition {
  id: string;
  agent: HookBridgeAgent;
  enabled: boolean;
  provider: HookBridgeProvider;
  intercept: 'shell-command' | 'tool-output';
  activation: 'registered-not-connected';
  dispatcherCommand: string;
  registeredAt: string;
}

interface HookBridgeFile {
  version: 1;
  bridges: HookBridgeDefinition[];
}

export interface HookBridgeStatus {
  path: string;
  bridges: readonly HookBridgeDefinition[];
  issue?: string;
}

export interface HookBridgePreview {
  status: 'ready' | 'unavailable' | 'error';
  agent: HookBridgeAgent;
  path: string;
  operation: 'create' | 'update' | 'unchanged';
  bridge: HookBridgeDefinition;
  beforeHash?: string;
  afterHash: string;
  requiresApproval: true;
  writesAgentConfig: false;
  activation: 'registered-not-connected';
  issue?: string;
}

export interface HookBridgeApplyResult {
  preview: HookBridgePreview;
  receipt: ActionReceipt;
}

export interface HookRewriteResult {
  status: 'rewritten' | 'passthrough';
  agent: HookBridgeAgent;
  command: string;
  rewritten?: string;
  executesCommand: false;
  reason?: string;
}

export interface HookFilterResult {
  status: 'filtered' | 'passthrough';
  agent: HookBridgeAgent;
  output: string;
  filter?: NativeFilterResult;
  reason?: string;
}

export interface HookBridgeOptions extends RtkOptions, ActionReceiptStoreOptions {
  configPath?: string;
  now?: () => Date;
  provider?: HookBridgeProvider;
}

function defaultHookBridgePath(options: HookBridgeOptions = {}): string {
  const home = options.home ?? homedir();
  const configHome = options.env?.['XDG_CONFIG_HOME'] ?? process.env['XDG_CONFIG_HOME'];
  return join(configHome || join(home, '.config'), 'tokray', 'hook-bridges.json');
}

function configPath(options: HookBridgeOptions): string {
  return options.configPath ?? defaultHookBridgePath(options);
}

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isAgent(value: unknown): value is HookBridgeAgent {
  return value === 'claude-code' || value === 'codex' || value === 'codebuddy' || value === 'trae';
}

function isProvider(value: unknown): value is HookBridgeProvider {
  return value === 'tokray-native' || value === 'rtk';
}

function parseBridge(value: unknown): HookBridgeDefinition | undefined {
  const item = object(value);
  if (!item || typeof item['id'] !== 'string' || !isAgent(item['agent'])) return undefined;
  if (!isProvider(item['provider'])) return undefined;
  const intercept = item['provider'] === 'rtk' ? 'shell-command' : 'tool-output';
  if (item['intercept'] !== intercept) return undefined;
  return {
    id: item['id'],
    agent: item['agent'],
    enabled: item['enabled'] === true,
    provider: item['provider'],
    intercept,
    activation: 'registered-not-connected',
    dispatcherCommand: typeof item['dispatcherCommand'] === 'string'
      ? item['dispatcherCommand']
      : item['provider'] === 'rtk'
        ? `tokray hook rewrite --agent ${item['agent']}`
        : `tokray hook filter --agent ${item['agent']} --profile auto`,
    registeredAt: typeof item['registeredAt'] === 'string' ? item['registeredAt'] : '',
  };
}

async function readBridgeFile(path: string): Promise<{ content?: string; file: HookBridgeFile; issue?: string }> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file: { version: 1, bridges: [] } };
    return { file: { version: 1, bridges: [] }, issue: error instanceof Error ? error.message : 'read failed' };
  }
  try {
    const root = object(JSON.parse(content) as unknown);
    if (root?.['version'] !== 1 || !Array.isArray(root['bridges'])) {
      return { content, file: { version: 1, bridges: [] }, issue: 'Invalid Hook Bridge configuration' };
    }
    return {
      content,
      file: { version: 1, bridges: root['bridges'].map(parseBridge).filter((item): item is HookBridgeDefinition => item !== undefined) },
    };
  } catch (error) {
    return { content, file: { version: 1, bridges: [] }, issue: error instanceof Error ? error.message : 'invalid JSON' };
  }
}

function bridgeFor(agent: HookBridgeAgent, provider: HookBridgeProvider, registeredAt: string): HookBridgeDefinition {
  return {
    id: provider === 'rtk' ? `rtk-shell-${agent}` : `tokray-output-${agent}`,
    agent,
    enabled: true,
    provider,
    intercept: provider === 'rtk' ? 'shell-command' : 'tool-output',
    activation: 'registered-not-connected',
    dispatcherCommand: provider === 'rtk'
      ? `tokray hook rewrite --agent ${agent}`
      : `tokray hook filter --agent ${agent} --profile auto`,
    registeredAt,
  };
}

function serialized(file: HookBridgeFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export async function inspectHookBridges(options: HookBridgeOptions = {}): Promise<HookBridgeStatus> {
  const path = configPath(options);
  const loaded = await readBridgeFile(path);
  return { path, bridges: loaded.file.bridges, ...(loaded.issue ? { issue: loaded.issue } : {}) };
}

/** Dispatcher used by an Agent-native Hook. It only returns a command rewrite and never executes it. */
export async function dispatchHookRewrite(
  agent: HookBridgeAgent,
  command: string,
  options: HookBridgeOptions = {},
): Promise<HookRewriteResult> {
  const status = await inspectHookBridges(options);
  if (!status.bridges.some((bridge) => bridge.agent === agent && bridge.provider === 'rtk' && bridge.enabled)) {
    return { status: 'passthrough', agent, command, executesCommand: false, reason: 'bridge-not-registered' };
  }
  const rewrite = await previewRtkRewrite(command, options);
  if (rewrite.status !== 'ready' || !rewrite.rewritten) {
    return { status: 'passthrough', agent, command, executesCommand: false, reason: rewrite.issue ?? rewrite.status };
  }
  return { status: 'rewritten', agent, command, rewritten: rewrite.rewritten, executesCommand: false };
}

/** Post-tool dispatcher for the built-in deterministic output filter. */
export async function dispatchHookFilter(
  agent: HookBridgeAgent,
  output: string,
  filterOptions: NativeFilterOptions = {},
  options: HookBridgeOptions = {},
): Promise<HookFilterResult> {
  const status = await inspectHookBridges(options);
  if (!status.bridges.some((bridge) => bridge.agent === agent && bridge.provider === 'tokray-native' && bridge.enabled)) {
    return { status: 'passthrough', agent, output, reason: 'bridge-not-registered' };
  }
  try {
    const filter = filterNativeOutput(output, filterOptions);
    return { status: filter.changed ? 'filtered' : 'passthrough', agent, output: filter.output, filter };
  } catch (error) {
    return {
      status: 'passthrough',
      agent,
      output,
      reason: error instanceof Error ? `filter-error: ${error.message}` : 'filter-error',
    };
  }
}

export async function previewHookBridge(
  agent: HookBridgeAgent,
  options: HookBridgeOptions = {},
): Promise<HookBridgePreview> {
  const path = configPath(options);
  const loaded = await readBridgeFile(path);
  const registeredAt = (options.now?.() ?? new Date()).toISOString();
  const provider = options.provider ?? 'tokray-native';
  const bridgeId = provider === 'rtk' ? `rtk-shell-${agent}` : `tokray-output-${agent}`;
  const existing = loaded.file.bridges.find((item) => item.id === bridgeId);
  const bridge = existing ?? bridgeFor(agent, provider, registeredAt);
  const bridges = existing
    ? loaded.file.bridges.map((item) => item.id === bridge.id ? { ...bridge, enabled: true } : item)
    : [...loaded.file.bridges, bridge];
  const after = serialized({ version: 1, bridges });
  const base = {
    agent,
    path,
    operation: existing?.enabled ? 'unchanged' as const : loaded.content ? 'update' as const : 'create' as const,
    bridge: existing?.enabled ? existing : { ...bridge, enabled: true },
    ...(loaded.content ? { beforeHash: hash(loaded.content) } : {}),
    afterHash: hash(after),
    requiresApproval: true as const,
    writesAgentConfig: false as const,
    activation: 'registered-not-connected' as const,
  };
  if (loaded.issue) return { ...base, status: 'error', issue: loaded.issue };
  if (provider === 'rtk') {
    const rtk = await inspectRtk(options);
    if (rtk.availability !== 'available') {
      return { ...base, status: 'unavailable', issue: rtk.issue ?? rtk.availability };
    }
  }
  return { ...base, status: 'ready' };
}

export async function applyHookBridge(
  agent: HookBridgeAgent,
  approval: { approved: true; expectedAfterHash: string; registeredAt: string },
  options: HookBridgeOptions = {},
): Promise<HookBridgeApplyResult> {
  if (approval.approved !== true) throw new Error('Explicit approval is required');
  const approvedAt = (options.now?.() ?? new Date()).toISOString();
  const registeredAt = new Date(approval.registeredAt);
  if (Number.isNaN(registeredAt.getTime())) throw new Error('Invalid Hook Bridge preview timestamp');
  const preview = await previewHookBridge(agent, { ...options, now: () => registeredAt });
  if (preview.status !== 'ready') throw new Error(preview.issue ?? preview.status);
  if (preview.afterHash !== approval.expectedAfterHash) throw new Error('Hook Bridge preview changed after approval; preview it again');
  if (preview.operation === 'unchanged') throw new Error('Hook Bridge is already registered');
  const loaded = await readBridgeFile(preview.path);
  const bridges = loaded.file.bridges.filter((item) => item.id !== preview.bridge.id);
  const after = serialized({ version: 1, bridges: [...bridges, preview.bridge] });
  if (hash(after) !== preview.afterHash) throw new Error('Hook Bridge configuration changed after preview');
  await writeAtomic(preview.path, after);
  const completedAt = (options.now?.() ?? new Date()).toISOString();
  const receipt = await createActionReceipt({
    action: 'register-hook-bridge',
    target: 'tool-hook',
    status: 'applied',
    actor: 'local-user',
    approvedAt,
    completedAt,
    summary: `Registered the Tokray-managed ${preview.bridge.provider} bridge for ${agent}`,
    changes: [{
      kind: loaded.content ? 'update-file' : 'create-file',
      target: preview.path,
      ...(loaded.content ? { beforeHash: hash(loaded.content) } : {}),
      afterHash: preview.afterHash,
    }],
    rollback: { available: true },
    result: {
      bridgeId: preview.bridge.id,
      agent,
      provider: preview.bridge.provider,
      activation: preview.activation,
      writesAgentConfig: false,
    },
    privateState: {
      configPath: preview.path,
      beforeContent: loaded.content ?? null,
      afterHash: preview.afterHash,
    },
  }, options);
  return { preview, receipt };
}

export async function rollbackHookBridge(
  receiptId: string,
  approval: { approved: true },
  options: HookBridgeOptions = {},
): Promise<ActionReceipt> {
  if (approval.approved !== true) throw new Error('Explicit approval is required');
  const existingReceipts = await listActionReceipts(options, 500);
  if (existingReceipts.some((receipt) => receipt.reversesReceiptId === receiptId)) {
    throw new Error('Receipt was already rolled back');
  }
  const stored = await readStoredActionReceipt(receiptId, options);
  if (!stored || !['register-hook-bridge', 'register-rtk-hook-bridge'].includes(stored.receipt.action)) throw new Error('Rollback receipt not found');
  const state = stored.privateState;
  const path = typeof state?.['configPath'] === 'string' ? state['configPath'] : undefined;
  const afterHash = typeof state?.['afterHash'] === 'string' ? state['afterHash'] : undefined;
  const beforeContent = state?.['beforeContent'];
  if (!path || !afterHash || (beforeContent !== null && typeof beforeContent !== 'string')) throw new Error('Rollback state is incomplete');
  let current: string;
  try {
    current = await readFile(path, 'utf8');
  } catch {
    throw new Error('Hook Bridge configuration is missing; rollback was not applied');
  }
  if (hash(current) !== afterHash) throw new Error('Hook Bridge configuration changed after apply; rollback was blocked');
  if (beforeContent === null) await rm(path);
  else await writeAtomic(path, beforeContent);
  const completedAt = (options.now?.() ?? new Date()).toISOString();
  const result: Record<string, JsonValue> = { restoredPreviousFile: beforeContent !== null };
  return createActionReceipt({
    action: 'rollback-hook-bridge',
    target: 'tool-hook',
    status: 'rolled-back',
    actor: 'local-user',
    approvedAt: completedAt,
    completedAt,
    summary: `Rolled back ${stored.receipt.summary}`,
    changes: [{
      kind: beforeContent === null ? 'delete-file' : 'update-file',
      target: path,
      beforeHash: afterHash,
      ...(beforeContent === null ? {} : { afterHash: hash(beforeContent) }),
    }],
    rollback: { available: false, reason: 'rollback-receipt' },
    result,
    reversesReceiptId: receiptId,
  }, options);
}
