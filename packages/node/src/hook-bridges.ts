import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

export interface CodexPostToolUseOutput {
  continue: false;
  stopReason: string;
}

export interface CodexPostToolUseResult {
  status: 'filtered' | 'passthrough';
  hookOutput?: CodexPostToolUseOutput;
  filter?: NativeFilterResult;
  reason?: string;
}

interface CodexTextualToolResponse {
  output: string;
}

export interface CodexHookConnectionPreview {
  status: 'ready' | 'unavailable' | 'error';
  path: string;
  operation: 'create' | 'update' | 'unchanged';
  hookEvent: 'PostToolUse';
  dispatcherCommand: string;
  beforeHash?: string;
  afterHash: string;
  requiresApproval: true;
  writesAgentConfig: true;
  requiresCodexTrust: true;
  activation: 'agent-config-written-trust-required';
  issue?: string;
}

export interface CodexHookConnectionApplyResult {
  preview: CodexHookConnectionPreview;
  receipt: ActionReceipt;
}

export type CodexHookActivationState = 'not-configured' | 'pending-trust' | 'active' | 'invalid';
export type CodexHookTrustStatus = 'trusted' | 'untrusted' | 'modified' | 'managed';

export interface CodexHookRuntimeStatus {
  state: CodexHookActivationState;
  cwd: string;
  path: string;
  dispatcherCommand: string;
  bridgeRegistered: boolean;
  configured: boolean;
  enabled?: boolean;
  trustStatus?: CodexHookTrustStatus;
  currentHash?: string;
  hookKey?: string;
  warnings: readonly string[];
  issue?: string;
}

export interface CodexHookSelfTestResult {
  status: 'passed' | 'failed';
  modelCalls: 0;
  runtime: CodexHookRuntimeStatus;
  inputBytes: number;
  outputBytes: number;
  reductionPercentage: number;
  checks: {
    bridgeRegistered: boolean;
    hookConfigured: boolean;
    hookTrusted: boolean;
    dispatcherFiltered: boolean;
    markersPreserved: boolean;
  };
  outputPreview?: string;
  issue?: string;
}

export interface HookBridgeOptions extends RtkOptions, ActionReceiptStoreOptions {
  configPath?: string;
  codexHooksPath?: string;
  codexExecutable?: string;
  cwd?: string;
  dispatcherCommand?: string;
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

function codexHooksPath(options: HookBridgeOptions): string {
  return options.codexHooksPath ?? join(options.cwd ?? process.cwd(), '.codex', 'hooks.json');
}

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function codexTextBlocks(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const text: string[] = [];
  for (const block of value) {
    if (typeof block === 'string') {
      text.push(block);
      continue;
    }
    const item = object(block);
    const type = item?.['type'];
    if (!item || typeof item['text'] !== 'string'
      || (type !== undefined && type !== 'text' && type !== 'input_text' && type !== 'output_text')) {
      return undefined;
    }
    text.push(item['text']);
  }
  return text;
}

function codexToolMetadata(value: Record<string, unknown>): string | undefined {
  const fields = ['exit_code', 'status', 'wall_time_seconds', 'original_token_count'] as const;
  const metadata = fields.flatMap((key) => {
    const item = value[key];
    return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      ? [`${key}=${String(item)}`]
      : [];
  });
  return metadata.length > 0 ? `[tokray tool metadata] ${metadata.join(' ')}` : undefined;
}

/** Extract only documented, model-facing textual shapes; unknown structured data stays untouched. */
function codexTextualToolResponse(value: unknown): CodexTextualToolResponse | undefined {
  if (typeof value === 'string') return { output: value };
  const blocks = codexTextBlocks(value);
  if (blocks) return { output: blocks.join('\n') };
  const item = object(value);
  if (!item || item['structuredContent'] !== undefined || item['data'] !== undefined) return undefined;
  const direct = typeof item['output'] === 'string'
    ? item['output']
    : typeof item['text'] === 'string'
      ? item['text']
      : undefined;
  const nestedBlocks = direct === undefined
    ? codexTextBlocks(item['content'] ?? item['output'])
    : undefined;
  const output = direct ?? nestedBlocks?.join('\n');
  if (output === undefined) return undefined;
  const metadata = codexToolMetadata(item);
  return { output: metadata ? `${metadata}\n${output}` : output };
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

interface CodexHooksFile {
  content?: string;
  root: Record<string, unknown>;
  postToolUse: unknown[];
  issue?: string;
}

async function readCodexHooksFile(path: string): Promise<CodexHooksFile> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root: {}, postToolUse: [] };
    return { root: {}, postToolUse: [], issue: error instanceof Error ? error.message : 'read failed' };
  }
  try {
    const root = object(JSON.parse(content) as unknown);
    if (!root) return { content, root: {}, postToolUse: [], issue: 'Codex hooks configuration must be a JSON object' };
    const hooks = root['hooks'] === undefined ? {} : object(root['hooks']);
    if (!hooks) return { content, root, postToolUse: [], issue: 'Codex hooks field must be a JSON object' };
    const postToolUse = hooks['PostToolUse'] === undefined ? [] : hooks['PostToolUse'];
    if (!Array.isArray(postToolUse)) {
      return { content, root, postToolUse: [], issue: 'Codex hooks.PostToolUse must be an array' };
    }
    for (const group of postToolUse) {
      const item = object(group);
      if (!item || !Array.isArray(item['hooks'])) {
        return { content, root, postToolUse, issue: 'Each Codex PostToolUse matcher group must contain a hooks array' };
      }
    }
    return { content, root, postToolUse };
  } catch (error) {
    return { content, root: {}, postToolUse: [], issue: error instanceof Error ? error.message : 'invalid JSON' };
  }
}

function hasCodexDispatcher(groups: readonly unknown[], dispatcherCommand: string): boolean {
  let matches = 0;
  let current = false;
  for (const group of groups) {
    const item = object(group);
    const handlers = item?.['hooks'];
    if (!Array.isArray(handlers)) continue;
    for (const handler of handlers) {
      if (!isTokrayCodexHandler(handler)) continue;
      matches += 1;
      const value = object(handler);
      current = current || (matches === 1
        && handlers.length === 1
        && item?.['matcher'] === '*'
        && value?.['type'] === 'command'
        && typeof value['command'] === 'string'
        && value['command'].trim() === dispatcherCommand
        && value['timeout'] === 30
        && value['statusMessage'] === 'Filtering tool output with Tokray');
    }
  }
  return matches === 1 && current;
}

function isTokrayCodexHandler(value: unknown): boolean {
  const handler = object(value);
  return handler?.['type'] === 'command'
    && handler['statusMessage'] === 'Filtering tool output with Tokray';
}

function removeTokrayCodexHandlers(groups: readonly unknown[]): unknown[] {
  return groups.flatMap((group) => {
    const item = object(group);
    const handlers = item?.['hooks'];
    if (!item || !Array.isArray(handlers)) return [group];
    const retained = handlers.filter((handler) => !isTokrayCodexHandler(handler));
    return retained.length > 0 ? [{ ...item, hooks: retained }] : [];
  });
}

async function prepareCodexHookConnection(options: HookBridgeOptions): Promise<{
  preview: CodexHookConnectionPreview;
  beforeContent?: string;
  afterContent: string;
}> {
  const path = codexHooksPath(options);
  const bridgeStatus = await inspectHookBridges(options);
  const bridge = bridgeStatus.bridges.find((item) => item.agent === 'codex'
    && item.provider === 'tokray-native' && item.enabled);
  const dispatcherCommand = options.dispatcherCommand?.trim()
    || bridge?.dispatcherCommand
    || 'tokray hook filter --agent codex --profile auto';
  const loaded = await readCodexHooksFile(path);
  const alreadyConnected = hasCodexDispatcher(loaded.postToolUse, dispatcherCommand);
  const rootHooks = object(loaded.root['hooks']) ?? {};
  const nextGroups = alreadyConnected ? loaded.postToolUse : [
    ...removeTokrayCodexHandlers(loaded.postToolUse),
    {
      matcher: '*',
      hooks: [{
        type: 'command',
        command: dispatcherCommand,
        timeout: 30,
        statusMessage: 'Filtering tool output with Tokray',
      }],
    },
  ];
  const afterContent = alreadyConnected && loaded.content
    ? loaded.content
    : `${JSON.stringify({ ...loaded.root, hooks: { ...rootHooks, PostToolUse: nextGroups } }, null, 2)}\n`;
  const operation = alreadyConnected ? 'unchanged' as const : loaded.content ? 'update' as const : 'create' as const;
  const base = {
    path,
    operation,
    hookEvent: 'PostToolUse' as const,
    dispatcherCommand,
    ...(loaded.content ? { beforeHash: hash(loaded.content) } : {}),
    afterHash: hash(afterContent),
    requiresApproval: true as const,
    writesAgentConfig: true as const,
    requiresCodexTrust: true as const,
    activation: 'agent-config-written-trust-required' as const,
  };
  const preview: CodexHookConnectionPreview = loaded.issue
    ? { ...base, status: 'error', issue: loaded.issue }
    : !bridge
      ? { ...base, status: 'unavailable', issue: 'Register the Tokray Native Codex Bridge before connecting its Hook' }
      : { ...base, status: 'ready' };
  return { preview, ...(loaded.content ? { beforeContent: loaded.content } : {}), afterContent };
}

function bridgeFor(
  agent: HookBridgeAgent,
  provider: HookBridgeProvider,
  registeredAt: string,
  dispatcherCommand?: string,
): HookBridgeDefinition {
  return {
    id: provider === 'rtk' ? `rtk-shell-${agent}` : `tokray-output-${agent}`,
    agent,
    enabled: true,
    provider,
    intercept: provider === 'rtk' ? 'shell-command' : 'tool-output',
    activation: 'registered-not-connected',
    dispatcherCommand: dispatcherCommand?.trim() || (provider === 'rtk'
      ? `tokray hook rewrite --agent ${agent}`
      : `tokray hook filter --agent ${agent} --profile auto`),
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

/** Adapter for Codex's documented PostToolUse command-hook JSON contract. */
export async function dispatchCodexPostToolUse(
  input: unknown,
  filterOptions: NativeFilterOptions = {},
  options: HookBridgeOptions = {},
): Promise<CodexPostToolUseResult> {
  const event = object(input);
  if (!event || event['hook_event_name'] !== 'PostToolUse') {
    return { status: 'passthrough', reason: 'unsupported-codex-hook-event' };
  }
  const toolResponse = codexTextualToolResponse(event['tool_response']);
  if (!toolResponse) {
    return { status: 'passthrough', reason: 'unsupported-codex-tool-response' };
  }
  const toolInput = object(event['tool_input']);
  const command = typeof toolInput?.['command'] === 'string'
    ? toolInput['command']
    : typeof toolInput?.['cmd'] === 'string'
      ? toolInput['cmd']
      : undefined;
  const dispatched = await dispatchHookFilter('codex', toolResponse.output, {
    ...filterOptions,
    ...(filterOptions.command === undefined && command ? { command } : {}),
  }, options);
  if (dispatched.status !== 'filtered' || !dispatched.filter) {
    return { status: 'passthrough', ...(dispatched.reason ? { reason: dispatched.reason } : {}) };
  }
  return {
    status: 'filtered',
    hookOutput: { continue: false, stopReason: dispatched.output },
    filter: dispatched.filter,
  };
}

interface CodexHookListMetadata {
  key?: string;
  command?: string;
  sourcePath?: string;
  enabled?: boolean;
  currentHash?: string;
  trustStatus?: CodexHookTrustStatus;
}

interface CodexHookListResult {
  hooks: CodexHookListMetadata[];
  warnings: string[];
  errors: string[];
}

function codexRuntimeCwd(options: HookBridgeOptions): string {
  if (options.cwd) return resolve(options.cwd);
  return dirname(dirname(resolve(codexHooksPath(options))));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isCodexHookTrustStatus(value: unknown): value is CodexHookTrustStatus {
  return value === 'trusted' || value === 'untrusted' || value === 'modified' || value === 'managed';
}

function parseCodexHookList(value: unknown, cwd: string): CodexHookListResult | undefined {
  const result = object(object(value)?.['result']);
  const data = result?.['data'];
  if (!Array.isArray(data)) return undefined;
  const entry = data.map(object).find((item) => item?.['cwd'] === cwd) ?? object(data[0]);
  if (!entry) return { hooks: [], warnings: [], errors: ['Codex returned no Hook status for this project'] };
  const hooks = Array.isArray(entry['hooks']) ? entry['hooks'].flatMap((value) => {
    const item = object(value);
    if (!item) return [];
    const trustStatus = item['trustStatus'];
    const metadata: CodexHookListMetadata = {
      ...(typeof item['key'] === 'string' ? { key: item['key'] } : {}),
      ...(typeof item['command'] === 'string' ? { command: item['command'] } : {}),
      ...(typeof item['sourcePath'] === 'string' ? { sourcePath: item['sourcePath'] } : {}),
      ...(typeof item['enabled'] === 'boolean' ? { enabled: item['enabled'] } : {}),
      ...(typeof item['currentHash'] === 'string' ? { currentHash: item['currentHash'] } : {}),
      ...(isCodexHookTrustStatus(trustStatus) ? { trustStatus } : {}),
    };
    return [metadata];
  }) : [];
  return {
    hooks,
    warnings: stringArray(entry['warnings']),
    errors: stringArray(entry['errors']),
  };
}

async function queryCodexHookList(cwd: string, options: HookBridgeOptions): Promise<CodexHookListResult> {
  const executable = options.codexExecutable
    ?? options.env?.['TOKRAY_CODEX_EXECUTABLE']
    ?? process.env['TOKRAY_CODEX_EXECUTABLE']
    ?? 'codex';
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, [
      'app-server', '--stdio', '--disable', 'plugins', '--disable', 'apps',
    ], {
      cwd,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: CodexHookListResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
      if (error) reject(error);
      else resolveResult(result ?? { hooks: [], warnings: [], errors: [] });
    };
    const consume = () => {
      let newline = stdout.indexOf('\n');
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as unknown;
            if (object(message)?.['id'] === 1) {
              const parsed = parseCodexHookList(message, cwd);
              if (parsed) finish(undefined, parsed);
              else finish(new Error('Codex returned an invalid hooks/list response'));
              return;
            }
          } catch {
            /* App-server tracing can share stdout on older Codex builds. */
          }
        }
        newline = stdout.indexOf('\n');
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 1_000_000) finish(new Error('Codex hooks/list response exceeded 1 MB'));
      else consume();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => finish(error));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`Codex hooks/list exited with ${code ?? 'no status'}${stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ''}`));
    });
    const timer = setTimeout(() => finish(new Error('Codex hooks/list timed out after 5 seconds')), 5_000);
    const messages = [
      { method: 'initialize', id: 0, params: { clientInfo: { name: 'tokray', title: 'Tokray', version: '0.1.0' } } },
      { method: 'initialized', params: {} },
      { method: 'hooks/list', id: 1, params: { cwds: [cwd] } },
    ];
    child.stdin.write(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`);
  });
}

export async function inspectCodexHookRuntime(
  options: HookBridgeOptions = {},
): Promise<CodexHookRuntimeStatus> {
  const cwd = codexRuntimeCwd(options);
  const prepared = await prepareCodexHookConnection({ ...options, cwd });
  const preview = prepared.preview;
  const bridgeStatus = await inspectHookBridges(options);
  const bridgeRegistered = bridgeStatus.bridges.some((item) => item.agent === 'codex'
    && item.provider === 'tokray-native' && item.enabled);
  const base = {
    cwd,
    path: preview.path,
    dispatcherCommand: preview.dispatcherCommand,
    bridgeRegistered,
    configured: preview.operation === 'unchanged',
    warnings: [] as string[],
  };
  if (preview.status === 'error') return { ...base, state: 'invalid', issue: preview.issue ?? 'Invalid Codex Hook configuration' };
  if (preview.operation !== 'unchanged') {
    return { ...base, state: 'not-configured', issue: preview.issue ?? 'Tokray Codex Hook is not connected' };
  }
  let listed: CodexHookListResult;
  try {
    listed = await queryCodexHookList(cwd, options);
  } catch (error) {
    return { ...base, state: 'invalid', issue: error instanceof Error ? error.message : 'Codex Hook status check failed' };
  }
  const path = resolve(preview.path);
  const hook = listed.hooks.find((item) => item.command?.trim() === preview.dispatcherCommand
    && item.sourcePath !== undefined && resolve(item.sourcePath) === path);
  const warnings = [...listed.warnings, ...listed.errors];
  if (!hook) return { ...base, warnings, state: 'invalid', issue: 'Codex did not discover the configured Tokray Hook' };
  const detail = {
    ...base,
    warnings,
    ...(hook.enabled !== undefined ? { enabled: hook.enabled } : {}),
    ...(hook.trustStatus ? { trustStatus: hook.trustStatus } : {}),
    ...(hook.currentHash ? { currentHash: hook.currentHash } : {}),
    ...(hook.key ? { hookKey: hook.key } : {}),
  };
  if (!bridgeRegistered) return { ...detail, state: 'invalid', issue: 'Tokray Native Bridge is not registered' };
  if (hook.enabled === false) return { ...detail, state: 'invalid', issue: 'Tokray Hook is disabled in Codex' };
  if (hook.trustStatus === 'untrusted') return { ...detail, state: 'pending-trust', issue: 'Review and trust the current Hook in Codex /hooks' };
  if (hook.trustStatus === 'modified') return { ...detail, state: 'invalid', issue: 'The Tokray Hook changed after it was trusted' };
  if (hook.trustStatus !== 'trusted' && hook.trustStatus !== 'managed') {
    return { ...detail, state: 'invalid', issue: 'Codex did not report a trusted Hook state' };
  }
  return { ...detail, state: 'active' };
}

export async function selfTestCodexHook(
  options: HookBridgeOptions = {},
): Promise<CodexHookSelfTestResult> {
  const runtime = await inspectCodexHookRuntime(options);
  const repeated = 'BUILD_PROGRESS compiling deterministic module batch';
  const markers = [
    'ARTIFACT=tokray-local-self-test',
    'CHECKSUM=sha256:local-only',
    'RECORDS=64',
    'STATUS=PASS',
  ];
  const source = `${Array.from({ length: 64 }, () => repeated).join('\n')}\n${markers.join('\n')}\n`;
  const dispatched = await dispatchCodexPostToolUse({
    session_id: 'tokray-local-self-test',
    turn_id: 'tokray-local-self-test',
    hook_event_name: 'PostToolUse',
    model: 'none',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: 'tokray-local-self-test',
    tool_input: { command: 'tokray-local-self-test' },
    tool_response: { exit_code: 0, output: source },
  }, { profile: 'generic' }, options);
  const output = dispatched.hookOutput?.stopReason ?? '';
  const inputBytes = Buffer.byteLength(source);
  const outputBytes = Buffer.byteLength(output);
  const checks = {
    bridgeRegistered: runtime.bridgeRegistered,
    hookConfigured: runtime.configured,
    hookTrusted: runtime.state === 'active',
    dispatcherFiltered: dispatched.status === 'filtered' && outputBytes > 0 && outputBytes < inputBytes,
    markersPreserved: markers.every((marker) => output.includes(marker)),
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    status: passed ? 'passed' : 'failed',
    modelCalls: 0,
    runtime,
    inputBytes,
    outputBytes,
    reductionPercentage: inputBytes > 0 ? Number((((inputBytes - outputBytes) / inputBytes) * 100).toFixed(2)) : 0,
    checks,
    ...(output ? { outputPreview: output.slice(0, 1_000) } : {}),
    ...(!passed ? { issue: runtime.issue ?? dispatched.reason ?? 'Local Hook self-test failed' } : {}),
  };
}

export async function previewCodexHookConnection(
  options: HookBridgeOptions = {},
): Promise<CodexHookConnectionPreview> {
  return (await prepareCodexHookConnection(options)).preview;
}

export async function applyCodexHookConnection(
  approval: { approved: true; expectedAfterHash: string },
  options: HookBridgeOptions = {},
): Promise<CodexHookConnectionApplyResult> {
  if (approval.approved !== true) throw new Error('Explicit approval is required');
  const prepared = await prepareCodexHookConnection(options);
  const { preview } = prepared;
  if (preview.status !== 'ready') throw new Error(preview.issue ?? preview.status);
  if (preview.afterHash !== approval.expectedAfterHash) {
    throw new Error('Codex Hook preview changed after approval; preview it again');
  }
  if (preview.operation === 'unchanged') throw new Error('Codex PostToolUse Hook is already connected');
  let currentContent: string | undefined;
  try {
    currentContent = await readFile(preview.path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (currentContent !== prepared.beforeContent) {
    throw new Error('Codex hooks configuration changed after preview; preview it again');
  }
  await writeAtomic(preview.path, prepared.afterContent);
  const completedAt = (options.now?.() ?? new Date()).toISOString();
  const receipt = await createActionReceipt({
    action: 'connect-codex-post-tool-hook',
    target: 'tool-hook',
    status: 'applied',
    actor: 'local-user',
    approvedAt: completedAt,
    completedAt,
    summary: 'Connected the Tokray dispatcher to the Codex PostToolUse Hook',
    changes: [{
      kind: prepared.beforeContent ? 'update-file' : 'create-file',
      target: preview.path,
      ...(prepared.beforeContent ? { beforeHash: hash(prepared.beforeContent) } : {}),
      afterHash: preview.afterHash,
    }],
    rollback: { available: true },
    result: {
      hookEvent: preview.hookEvent,
      activation: preview.activation,
      requiresCodexTrust: true,
    },
    privateState: {
      configPath: preview.path,
      beforeContent: prepared.beforeContent ?? null,
      afterHash: preview.afterHash,
    },
  }, options);
  return { preview, receipt };
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
  const requestedDispatcher = options.dispatcherCommand?.trim();
  const bridge = existing
    ? { ...existing, enabled: true, ...(requestedDispatcher ? { dispatcherCommand: requestedDispatcher } : {}) }
    : bridgeFor(agent, provider, registeredAt, requestedDispatcher);
  const unchanged = existing?.enabled === true && existing.dispatcherCommand === bridge.dispatcherCommand;
  const bridges = existing
    ? loaded.file.bridges.map((item) => item.id === bridge.id ? bridge : item)
    : [...loaded.file.bridges, bridge];
  const after = serialized({ version: 1, bridges });
  const base = {
    agent,
    path,
    operation: unchanged ? 'unchanged' as const : loaded.content ? 'update' as const : 'create' as const,
    bridge,
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
  if (!stored || !['register-hook-bridge', 'register-rtk-hook-bridge', 'connect-codex-post-tool-hook'].includes(stored.receipt.action)) throw new Error('Rollback receipt not found');
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
