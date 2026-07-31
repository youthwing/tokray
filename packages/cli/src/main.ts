#!/usr/bin/env node
/**
 * Tokray CLI - parse a session log and print per-frame attribution.
 *
 *   tokray [file.jsonl]        parse and render (default: newest local session)
 *     --json <out.json>        also write machine-readable results
 *     --no-color               plain output
 *     --tail <n>               only render the last n frames (default 60)
 *
 * Zero runtime deps by design: node:fs + node:path only, argv parsed by hand.
 */

import { createReadStream } from 'node:fs';
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolsReport, calibrationFor, residentBreakdown } from '@tokray/core';
import type { Anomaly, ContextBlock, ContextFrame, TokenCount, ToolRosterDelta } from '@tokray/core';
import { detectAdapter } from '@tokray/adapters';
import { fmtTokens, renderFrame, renderLegend, renderSummary } from './ascii.js';

function commandArgument(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cliCommandPrefix(): string {
  return `${commandArgument(process.execPath)} ${commandArgument(fileURLToPath(import.meta.url))}`;
}

function nativeHookDispatcher(agent: string): string {
  return `${cliCommandPrefix()} hook filter --agent ${agent} --profile auto`;
}

interface Args {
  file?: string;
  json?: string;
  color: boolean;
  tail: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { color: process.stdout.isTTY === true, tail: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      const v = argv[++i];
      if (v !== undefined) args.json = v;
    } else if (a === '--no-color') args.color = false;
    else if (a === '--tail') args.tail = Number(argv[++i]) || 60;
    else if (a === '--help' || a === '-h') {
      console.log('usage: tokray [session.jsonl] [--json out.json] [--tail n] [--no-color]\n       tokray web [--port 4319]\n       tokray gateway --upstream <url> [--port 4318] [--host 127.0.0.1] [--max-input-tokens n] [--allow-tools names] [--compact-tool-results] [--tool-result-min-chars n]\n       tokray request govern [--input request.json] [--max-input-tokens n] [--allow-tools read_file,grep] [--report-json]\n       tokray filter [--profile auto|generic|test|build|json|git-status] [--input file] [--command value] [--report-json]\n       tokray hook filter --agent <agent> [--profile auto|generic|test|build|json|git-status] [--command value] [--exit-code n]\n       tokray hook connect --agent codex [--path .codex/hooks.json] [--apply --expected-after-hash sha256:...]\n       tokray hook status --agent codex [--path .codex/hooks.json]\n       tokray hook self-test --agent codex [--path .codex/hooks.json]\n       tokray hook rewrite --agent <agent> --command "git status"');
      process.exit(0);
    } else if (a !== undefined && !a.startsWith('-')) args.file = a;
  }
  return args;
}

/** Newest supported local coding-agent session log. */
async function discoverNewestSession(): Promise<string | null> {
  const roots = [
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.codex', 'sessions'),
    join(homedir(), '.codex', 'archived_sessions'),
  ];
  const candidates: { path: string; mtime: number }[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const s = await stat(path);
        candidates.push({ path, mtime: s.mtimeMs });
      } catch {
        /* raced deletion; skip */
      }
    }
  };
  for (const root of roots) await visit(root);
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'gateway') {
    const upstreamIndex = argv.indexOf('--upstream');
    const portIndex = argv.indexOf('--port');
    const hostIndex = argv.indexOf('--host');
    const budgetIndex = argv.indexOf('--max-input-tokens');
    const allowToolsIndex = argv.indexOf('--allow-tools');
    const resultMinIndex = argv.indexOf('--tool-result-min-chars');
    const upstreamBaseUrl = upstreamIndex >= 0
      ? argv[upstreamIndex + 1]
      : process.env['TOKRAY_GATEWAY_UPSTREAM'];
    const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : 4318;
    const hostname = hostIndex >= 0 ? argv[hostIndex + 1] : '127.0.0.1';
    const maxInputTokens = budgetIndex >= 0 ? Number(argv[budgetIndex + 1]) : undefined;
    const toolResultMinChars = resultMinIndex >= 0 ? Number(argv[resultMinIndex + 1]) : undefined;
    const allowedTools = allowToolsIndex >= 0
      ? (argv[allowToolsIndex + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean)
      : undefined;
    if (!upstreamBaseUrl || !hostname
      || !Number.isInteger(port) || port <= 0 || port > 65_535
      || (maxInputTokens !== undefined && (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0))
      || (toolResultMinChars !== undefined && (!Number.isInteger(toolResultMinChars) || toolResultMinChars <= 0))) {
      console.error('usage: tokray gateway --upstream <url> [--port 4318] [--host 127.0.0.1] [--max-input-tokens n] [--allow-tools names] [--compact-tool-results] [--tool-result-min-chars n]');
      process.exit(2);
    }
    const { startModelGateway } = await import('@tokray/node');
    const gateway = await startModelGateway({
      upstreamBaseUrl,
      hostname,
      port,
      governance: {
        ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
        ...(allowedTools !== undefined ? { allowedTools } : {}),
        compactToolResults: argv.includes('--compact-tool-results'),
        ...(toolResultMinChars !== undefined ? { toolResultMinChars } : {}),
      },
      onEvent: (event) => {
        const saved = event.governance?.estimatedSavedTokens ?? 0;
        console.error(`[gateway] ${event.method} ${event.path} ${event.responseStatus} ${event.status}${saved > 0 ? ` saved~${saved} tokens` : ''} ${event.durationMs}ms`);
      },
    });
    console.log(`Tokray model gateway listening on ${gateway.url}`);
    console.log(`Forwarding to ${gateway.upstreamBaseUrl}`);
    console.log(`Health: ${gateway.url}/__tokray/health`);
    const shutdown = async () => {
      await gateway.close();
      process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    return;
  }
  if (argv[0] === 'request' && argv[1] === 'govern') {
    const inputIndex = argv.indexOf('--input');
    const budgetIndex = argv.indexOf('--max-input-tokens');
    const allowToolsIndex = argv.indexOf('--allow-tools');
    const inputPath = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
    let source: string;
    if (inputPath) {
      source = await readFile(inputPath, 'utf8');
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      source = Buffer.concat(chunks).toString('utf8');
    }
    if (!source.trim()) {
      console.error('tokray request govern requires JSON on stdin or --input <request.json>');
      process.exit(2);
    }
    let input: unknown;
    try {
      input = JSON.parse(source);
    } catch (error) {
      console.error(`invalid request JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
      process.exit(2);
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      console.error('request JSON must be an object');
      process.exit(2);
    }
    const maxInputTokens = budgetIndex >= 0 ? Number(argv[budgetIndex + 1]) : undefined;
    if (maxInputTokens !== undefined && (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0)) {
      console.error('--max-input-tokens must be a positive integer');
      process.exit(2);
    }
    const allowedTools = allowToolsIndex >= 0
      ? (argv[allowToolsIndex + 1] ?? '').split(',').map((name) => name.trim()).filter(Boolean)
      : undefined;
    const { governNativeRequest } = await import('@tokray/node');
    const result = governNativeRequest(input as Record<string, unknown>, {
      ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
      ...(allowedTools !== undefined ? { allowedTools } : {}),
      compactToolDescriptions: !argv.includes('--no-compact-descriptions'),
      deduplicateTools: !argv.includes('--keep-duplicate-tools'),
    });
    process.stdout.write(`${JSON.stringify(argv.includes('--report-json') ? result : result.request, null, 2)}\n`);
    if (!result.budget.sendAllowed) {
      console.error(`request blocked: estimated ${result.governed.estimatedTokens.value} input Tokens exceeds budget ${result.budget.maxInputTokens}`);
      process.exitCode = 3;
    }
    return;
  }
  if (argv[0] === 'filter') {
    const profileIndex = argv.indexOf('--profile');
    const commandIndex = argv.indexOf('--command');
    const inputIndex = argv.indexOf('--input');
    const exitCodeIndex = argv.indexOf('--exit-code');
    const profile = profileIndex >= 0 ? argv[profileIndex + 1] : 'auto';
    const profiles = ['auto', 'generic', 'test', 'build', 'json', 'git-status'] as const;
    if (!profiles.includes(profile as (typeof profiles)[number])) {
      console.error(`unsupported profile: ${profile ?? ''}`);
      process.exit(2);
    }
    const inputPath = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
    let input: string;
    if (inputPath) {
      input = await readFile(inputPath, 'utf8');
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      input = Buffer.concat(chunks).toString('utf8');
    }
    if (input.length === 0) {
      console.error('tokray filter requires stdin or --input <file>');
      process.exit(2);
    }
    const { filterNativeOutput } = await import('@tokray/node');
    const parsedExitCode = exitCodeIndex >= 0 ? Number(argv[exitCodeIndex + 1]) : undefined;
    const result = filterNativeOutput(input, {
      profile: profile as (typeof profiles)[number],
      ...(commandIndex >= 0 && argv[commandIndex + 1] ? { command: argv[commandIndex + 1] } : {}),
      ...(parsedExitCode !== undefined && Number.isInteger(parsedExitCode) ? { exitCode: parsedExitCode } : {}),
    });
    if (argv.includes('--report-json')) console.log(JSON.stringify(result));
    else process.stdout.write(result.output);
    return;
  }
  if (argv[0] === 'hook' && argv[1] === 'rewrite') {
    const agentIndex = argv.indexOf('--agent');
    const commandIndex = argv.indexOf('--command');
    const agent = argv[agentIndex + 1];
    const command = argv[commandIndex + 1];
    if (!['claude-code', 'codex', 'codebuddy', 'trae'].includes(agent ?? '') || !command) {
      console.error('usage: tokray hook rewrite --agent <claude-code|codex|codebuddy|trae> --command "git status"');
      process.exit(2);
    }
    const { dispatchHookRewrite } = await import('@tokray/node');
    const result = await dispatchHookRewrite(
      agent as 'claude-code' | 'codex' | 'codebuddy' | 'trae',
      command,
    );
    console.log(JSON.stringify(result));
    return;
  }
  if (argv[0] === 'hook' && argv[1] === 'connect') {
    const agentIndex = argv.indexOf('--agent');
    const pathIndex = argv.indexOf('--path');
    const hashIndex = argv.indexOf('--expected-after-hash');
    const agent = argv[agentIndex + 1];
    const hooksPath = pathIndex >= 0 ? argv[pathIndex + 1] : undefined;
    if (agent !== 'codex') {
      console.error('usage: tokray hook connect --agent codex [--path .codex/hooks.json] [--apply --expected-after-hash sha256:...]');
      process.exit(2);
    }
    const node = await import('@tokray/node');
    if (argv.includes('--apply')) {
      const expectedAfterHash = hashIndex >= 0 ? argv[hashIndex + 1] : undefined;
      if (!expectedAfterHash) {
        console.error('--apply requires --expected-after-hash from a fresh preview');
        process.exit(2);
      }
      const result = await node.applyCodexHookConnection({ approved: true, expectedAfterHash }, {
        ...(hooksPath ? { codexHooksPath: hooksPath } : {}),
        dispatcherCommand: nativeHookDispatcher('codex'),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const preview = await node.previewCodexHookConnection({
      ...(hooksPath ? { codexHooksPath: hooksPath } : {}),
      dispatcherCommand: nativeHookDispatcher('codex'),
    });
    console.log(JSON.stringify(preview, null, 2));
    if (preview.status !== 'ready') process.exitCode = 3;
    return;
  }
  if (argv[0] === 'hook' && (argv[1] === 'status' || argv[1] === 'self-test')) {
    const agentIndex = argv.indexOf('--agent');
    const pathIndex = argv.indexOf('--path');
    const agent = argv[agentIndex + 1];
    const hooksPath = pathIndex >= 0 ? argv[pathIndex + 1] : undefined;
    if (agent !== 'codex') {
      console.error(`usage: tokray hook ${argv[1]} --agent codex [--path .codex/hooks.json]`);
      process.exit(2);
    }
    const node = await import('@tokray/node');
    const options = {
      ...(hooksPath ? { codexHooksPath: hooksPath } : {}),
      dispatcherCommand: nativeHookDispatcher('codex'),
    };
    if (argv[1] === 'status') {
      const result = await node.inspectCodexHookRuntime(options);
      console.log(JSON.stringify(result, null, 2));
      if (result.state !== 'active') process.exitCode = 3;
    } else {
      const result = await node.selfTestCodexHook(options);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== 'passed') process.exitCode = 3;
    }
    return;
  }
  if (argv[0] === 'hook' && argv[1] === 'filter') {
    const agentIndex = argv.indexOf('--agent');
    const profileIndex = argv.indexOf('--profile');
    const commandIndex = argv.indexOf('--command');
    const exitCodeIndex = argv.indexOf('--exit-code');
    const agent = argv[agentIndex + 1];
    const profile = profileIndex >= 0 ? argv[profileIndex + 1] : 'auto';
    const profiles = ['auto', 'generic', 'test', 'build', 'json', 'git-status'] as const;
    if (!['claude-code', 'codex', 'codebuddy', 'trae'].includes(agent ?? '')
      || !profiles.includes(profile as (typeof profiles)[number])) {
      console.error('usage: tokray hook filter --agent <claude-code|codex|codebuddy|trae> [--profile auto|generic|test|build|json|git-status]');
      process.exit(2);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const input = Buffer.concat(chunks).toString('utf8');
    const parsedExitCode = exitCodeIndex >= 0 ? Number(argv[exitCodeIndex + 1]) : undefined;
    const node = await import('@tokray/node');
    if (agent === 'codex') {
      let hookInput: unknown;
      try {
        hookInput = JSON.parse(input);
      } catch {
        hookInput = undefined;
      }
      if (hookInput !== null && typeof hookInput === 'object' && !Array.isArray(hookInput)
        && 'hook_event_name' in hookInput) {
        const result = await node.dispatchCodexPostToolUse(hookInput, {
          profile: profile as (typeof profiles)[number],
          ...(commandIndex >= 0 && argv[commandIndex + 1] ? { command: argv[commandIndex + 1] } : {}),
          ...(parsedExitCode !== undefined && Number.isInteger(parsedExitCode) ? { exitCode: parsedExitCode } : {}),
        });
        if (result.hookOutput) process.stdout.write(`${JSON.stringify(result.hookOutput)}\n`);
        return;
      }
    }
    const result = await node.dispatchHookFilter(
      agent as 'claude-code' | 'codex' | 'codebuddy' | 'trae',
      input,
      {
        profile: profile as (typeof profiles)[number],
        ...(commandIndex >= 0 && argv[commandIndex + 1] ? { command: argv[commandIndex + 1] } : {}),
        ...(parsedExitCode !== undefined && Number.isInteger(parsedExitCode) ? { exitCode: parsedExitCode } : {}),
      },
    );
    process.stdout.write(result.output);
    return;
  }
  if (argv[0] === 'web') {
    const portIndex = argv.indexOf('--port');
    const requestedPort = portIndex >= 0 ? Number(argv[portIndex + 1]) : 4319;
    const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 4319;
    const { startWebServer } = await import('@tokray/web/server');
    startWebServer({ port, hookCommandPrefix: cliCommandPrefix() });
    console.log(`Tokray web listening on http://127.0.0.1:${port}`);
    return;
  }
  const args = parseArgs(argv);

  let file = args.file;
  if (!file) {
    const found = await discoverNewestSession();
    if (!found) {
      console.error('no session file given and none found under ~/.claude/projects or ~/.codex');
      process.exit(1);
    }
    file = found;
    console.log(`no file given — using newest local session:\n  ${file}\n`);
  }

  // Probe strictly the first 64 KiB — session files reach hundreds of MB and
  // the SourceProbe contract forbids loading whole files.
  let head: string;
  try {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      // The window may end mid-multibyte-character; detect() tolerates that.
      head = buf.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch (e) {
    console.error(`cannot read ${file}: ${(e as Error).message}`);
    process.exit(1);
  }
  const adapter = detectAdapter({ head, name: file });
  if (!adapter) {
    console.error(`no adapter recognizes this file (probed first 64KiB): ${file}`);
    process.exit(1);
  }

  const frames: ContextFrame[] = [];
  const anomalies: Anomaly[] = [];
  const rosterDeltas: ToolRosterDelta[] = [];
  let epilogue: readonly ContextBlock[] = [];
  const stream = createReadStream(file) as AsyncIterable<Uint8Array>;
  for await (const ev of adapter.parse(stream, { sourceId: file })) {
    if (ev.t === 'frame') frames.push(ev.frame);
    else if (ev.t === 'anomaly') anomalies.push(ev.anomaly);
    else if (ev.t === 'roster') rosterDeltas.push(ev.delta);
    else if (ev.t === 'epilogue') epilogue = ev.blocks;
  }

  // All of these tolerate zero frames — the JSON export must keep ONE shape
  // whether or not the session contained model calls.
  const cal = calibrationFor(frames, adapter.capabilities.accounting);
  const tools = buildToolsReport(frames, rosterDeltas, epilogue);
  const components = tools.residentSuspects.flatMap((name) => {
    const tokens = adapter.schemaPricer?.price(name);
    return tokens ? [{ label: name, tokens }] : [];
  });
  const breakdown = residentBreakdown(cal, components);
  const exactTotals = frames.every((frame) => frame.providerUsage.source !== 'estimated');
  const wastedSchemaTokens: TokenCount = { value: 0, method: 'prior', errorBand: [0, 0] };
  if (adapter.schemaPricer) {
    let lo = 0;
    let hi = 0;
    for (const name of tools.loadedNeverCalled) {
      const p = adapter.schemaPricer.price(name);
      if (!p) continue;
      wastedSchemaTokens.value += p.value;
      lo += p.errorBand?.[0] ?? p.value;
      hi += p.errorBand?.[1] ?? p.value;
    }
    wastedSchemaTokens.errorBand = [lo, hi];
  }

  // Exported estimates are calibrated (× cal.scale), matching the terminal.
  // Exporting raw values under the same names as the rendered ones would
  // hand downstream consumers silently different numbers. TokenCounts with
  // method 'prior' are shipped constants and are NEVER scaled.
  const scaled = (v: number) => Math.round(v * cal.scale);
  const buildJson = () => ({
    meta: {
      file,
      adapter: adapter.id,
      generatedBy: 'Tokray 0.1.0',
      tokenValues:
        `estimator values calibrated (heuristic × calibration.scale); totals ${exactTotals ? 'from provider usage' : 'may be estimated from complete request content'}; values carrying method "prior" are shipped constants, never scaled`,
    },
    calibration: cal,
    frames: frames.map((f) => ({
      seq: f.seq,
      at: f.at,
      model: f.model,
      providerUsage: f.providerUsage,
      totals: f.totals,
      delta: { addedTokens: scaled(f.delta.addedTokens), carriedTokens: scaled(f.delta.carriedTokens) },
      blocks: f.blocks.length,
      kinds: Object.fromEntries(
        [...f.blocks.reduce((m, b) => {
          const k = b.attribution.kind;
          // Per-block scaling: prior-priced blocks (tool schemas, images)
          // keep their stated value; estimator blocks get calibrated.
          m.set(k, (m.get(k) ?? 0) + (b.tokens.method === 'prior' ? b.tokens.value : b.tokens.value * cal.scale));
          return m;
        }, new Map<string, number>())].map(([k, v]) => [k, Math.round(v)]),
      ),
    })),
    tools: {
      called: tools.called.map((t) => ({
        ...t,
        inputTokens: scaled(t.inputTokens),
        resultTokens: scaled(t.resultTokens),
      })),
      mcpServers: tools.mcpServers.map((m) => ({ ...m, resultTokens: scaled(m.resultTokens) })),
      deferredNeverLoaded: tools.deferredNeverLoaded,
      loaded: tools.loaded,
      loadedNeverCalled: tools.loadedNeverCalled,
      residentSuspects: tools.residentSuspects,
      wastedSchemaTokens,
    },
    residentBreakdown: breakdown,
    anomalies,
  });

  if (frames.length === 0) {
    // The zero-frame case is precisely when diagnostics matter most: surface
    // the anomalies and still honor --json. A session with no model calls and
    // no anomalies (user/system records only) is valid input, not a failure.
    console.error(`parsed 0 frames from ${file} (${anomalies.length} anomalies)`);
    for (const a of anomalies.slice(0, 10)) {
      console.error(`  [${a.code}] record ${a.atRecord}: ${a.detail}`);
    }
    if (anomalies.length > 10) console.error(`  … ${anomalies.length - 10} more (see --json)`);
    if (args.json) {
      await writeFile(args.json, JSON.stringify(buildJson(), null, 2));
      console.error(`json written to ${args.json}`);
    }
    process.exit(anomalies.length === 0 ? 0 : 1);
  }

  const maxTokens = Math.max(...frames.map((f) => f.totals.input));
  console.log(
    `Tokray · ${adapter.id} · ${frames.length} frames · ${exactTotals ? 'exact totals from provider usage' : 'request-content estimates'}\n`,
  );
  console.log(renderLegend(args.color));
  console.log('');
  const start = Math.max(0, frames.length - args.tail);
  if (start > 0) console.log(`  … ${start} earlier frames (use --tail ${frames.length} for all)`);
  for (const frame of frames.slice(start)) {
    console.log(renderFrame(frame, cal, maxTokens, args.color));
  }
  console.log(
    renderSummary(
      { file, frames, cal, anomalies: anomalies.length, tools, breakdown, wastedSchemaTokens, exactTotals },
      args.color,
    ),
  );

  if (args.json) {
    await writeFile(args.json, JSON.stringify(buildJson(), null, 2));
    console.log(`json written to ${args.json}`);
  }

  console.log(`${fmtTokens(frames[frames.length - 1]?.totals.input ?? 0)} tokens in the final context window.`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
