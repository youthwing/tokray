import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  analyzeSession,
  applyCodexHookConnection,
  applyHookBridge,
  discoverSessions,
  filterNativeOutput,
  inspectHookBridges,
  inspectAgentSources,
  invalidateSessionDiscovery,
  importRtkGain,
  inspectCodexHookRuntime,
  inspectRtk,
  listActionReceipts,
  loadTokrayConfiguration,
  nativeGovernanceStrategies,
  governNativeRequest,
  previewCodexHookConnection,
  previewHookBridge,
  previewRtkRewrite,
  readFrameConversation,
  readSessionConversation,
  rollbackHookBridge,
  runApprovedRtkComparison,
  selfTestCodexHook,
  subscribeSessionDiscovery,
} from '@tokray/node';
import type { AnalysisReport, HookBridgeAgent, HookBridgeProvider, NativeFilterProfile, SessionDiscoveryChange } from '@tokray/node';
import { WeightedLru } from './lru.js';

export interface WebServerOptions {
  hostname?: string;
  port?: number;
  hookCommandPrefix?: string;
}

export const app = new Hono();
const analysisCache = new WeightedLru<string, { modifiedAt: number; report: AnalysisReport }>({
  maxEntries: 8,
  maxWeight: 120_000,
});
const pendingAnalyses = new Map<string, Promise<AnalysisReport>>();
let discoveryCache: { at: number; sessions: Awaited<ReturnType<typeof discoverSessions>> } | undefined;
let hookCommandPrefix = 'tokray';

function hookDispatcher(agent: HookBridgeAgent, provider: HookBridgeProvider): string {
  return provider === 'rtk'
    ? `${hookCommandPrefix} hook rewrite --agent ${agent}`
    : `${hookCommandPrefix} hook filter --agent ${agent} --profile auto`;
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

async function localSessions(force = false) {
  if (force) invalidateSessionDiscovery();
  if (!force && discoveryCache && Date.now() - discoveryCache.at < 15_000) return discoveryCache.sessions;
  const sessions = await discoverSessions();
  discoveryCache = { at: Date.now(), sessions };
  return sessions;
}

function reportWeight(report: AnalysisReport): number {
  return report.frames.reduce((sum, frame) => sum + frame.blocks.length + 1, report.tailBlocks.length);
}

async function sessionAnalysis(session: Awaited<ReturnType<typeof discoverSessions>>[number]): Promise<AnalysisReport> {
  const cached = analysisCache.get(session.id);
  if (cached?.modifiedAt === session.modifiedAt) return cached.report;
  const key = `${session.id}:${session.modifiedAt}`;
  const existing = pendingAnalyses.get(key);
  if (existing) return existing;
  const pending = analyzeSession(session).then((report) => {
    analysisCache.set(session.id, { modifiedAt: session.modifiedAt, report }, reportWeight(report));
    return report;
  }).finally(() => pendingAnalyses.delete(key));
  pendingAnalyses.set(key, pending);
  return pending;
}

app.get('/api/health', (context) => context.json({ ok: true }));

app.get('/api/agent-sources', async (context) => {
  const statuses = await inspectAgentSources();
  return context.json(statuses.map((status) => ({
    ...status,
    paths: status.paths.map(displayPath),
    availablePaths: status.availablePaths.map(displayPath),
  })));
});

app.get('/api/config', async (context) => {
  const runtime = await loadTokrayConfiguration();
  return context.json({
    files: runtime.files.map(displayPath),
    sourceCount: runtime.sources.length,
    adapters: runtime.adapters.map((adapter) => adapter.id),
    issues: runtime.issues.map((issue) => ({ ...issue, file: displayPath(issue.file) })),
  });
});

app.get('/api/integrations/rtk', async (context) => {
  return context.json(await inspectRtk());
});

app.get('/api/governance/native-strategies', (context) => {
  return context.json(nativeGovernanceStrategies());
});

app.post('/api/governance/native-request/preview', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const request = body?.['request'];
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return context.json({ error: 'request must be a JSON object' }, 400);
  }
  const allowedTools = body?.['allowedTools'];
  if (allowedTools !== undefined
    && (!Array.isArray(allowedTools) || !allowedTools.every((name) => typeof name === 'string'))) {
    return context.json({ error: 'allowedTools must be an array of strings' }, 400);
  }
  if (body?.['compactToolDescriptions'] !== undefined && typeof body['compactToolDescriptions'] !== 'boolean') {
    return context.json({ error: 'compactToolDescriptions must be a boolean' }, 400);
  }
  if (body?.['deduplicateTools'] !== undefined && typeof body['deduplicateTools'] !== 'boolean') {
    return context.json({ error: 'deduplicateTools must be a boolean' }, 400);
  }
  try {
    return context.json(governNativeRequest(request as Record<string, unknown>, {
      ...(body?.['maxInputTokens'] !== undefined ? { maxInputTokens: body['maxInputTokens'] as number } : {}),
      ...(allowedTools !== undefined ? { allowedTools: allowedTools as string[] } : {}),
      ...(typeof body?.['compactToolDescriptions'] === 'boolean'
        ? { compactToolDescriptions: body['compactToolDescriptions'] }
        : {}),
      ...(typeof body?.['deduplicateTools'] === 'boolean' ? { deduplicateTools: body['deduplicateTools'] } : {}),
    }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Native request preview failed' }, 400);
  }
});

const nativeProfiles = new Set<NativeFilterProfile>(['auto', 'generic', 'test', 'build', 'json', 'git-status']);

app.post('/api/integrations/native-filter/preview', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const output = body?.['output'];
  const profile = body?.['profile'] ?? 'auto';
  if (typeof output !== 'string') return context.json({ error: 'output must be a string' }, 400);
  if (typeof profile !== 'string' || !nativeProfiles.has(profile as NativeFilterProfile)) {
    return context.json({ error: 'Unsupported native filter profile' }, 400);
  }
  try {
    return context.json(filterNativeOutput(output, {
      profile: profile as NativeFilterProfile,
      ...(typeof body?.['command'] === 'string' && body['command'].trim() ? { command: body['command'] } : {}),
      ...(typeof body?.['exitCode'] === 'number' && Number.isInteger(body['exitCode']) ? { exitCode: body['exitCode'] } : {}),
    }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Native output preview failed' }, 400);
  }
});

app.post('/api/integrations/rtk/gain', async (context) => {
  return context.json(await importRtkGain());
});

app.post('/api/integrations/rtk/rewrite', async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: 'Expected a JSON request body' }, 400);
  }
  const command = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)['command']
    : undefined;
  if (typeof command !== 'string') return context.json({ error: 'command must be a string' }, 400);
  try {
    return context.json(await previewRtkRewrite(command));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'RTK rewrite preview failed' }, 400);
  }
});

app.post('/api/integrations/rtk/compare', async (context) => {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: 'Expected a JSON request body' }, 400);
  }
  const input = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  if (typeof input['command'] !== 'string' || typeof input['expectedRewrite'] !== 'string') {
    return context.json({ error: 'command and expectedRewrite must be strings' }, 400);
  }
  if (input['approved'] !== true) return context.json({ error: 'Explicit approval is required' }, 400);
  try {
    return context.json(await runApprovedRtkComparison(input['command'], {
      approved: true,
      expectedRewrite: input['expectedRewrite'],
    }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'RTK comparison failed' }, 409);
  }
});

const hookBridgeAgents = new Set<HookBridgeAgent>(['claude-code', 'codex', 'codebuddy', 'trae']);
const hookBridgeProviders = new Set<HookBridgeProvider>(['tokray-native', 'rtk']);
const hookAgent = (value: unknown): HookBridgeAgent | undefined =>
  typeof value === 'string' && hookBridgeAgents.has(value as HookBridgeAgent)
    ? value as HookBridgeAgent
    : undefined;
const hookProvider = (value: unknown): HookBridgeProvider | undefined =>
  typeof value === 'string' && hookBridgeProviders.has(value as HookBridgeProvider)
    ? value as HookBridgeProvider
    : undefined;

app.get('/api/governance/receipts', async (context) => {
  return context.json(await listActionReceipts());
});

app.get('/api/integrations/hooks', async (context) => {
  return context.json(await inspectHookBridges());
});

app.post('/api/integrations/hooks/preview', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const agent = hookAgent(body?.['agent']);
  const provider = hookProvider(body?.['provider']);
  if (!agent || !provider) return context.json({ error: 'Unsupported Hook Bridge agent or provider' }, 400);
  return context.json(await previewHookBridge(agent, {
    provider,
    dispatcherCommand: hookDispatcher(agent, provider),
  }));
});

app.post('/api/integrations/hooks/apply', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const agent = hookAgent(body?.['agent']);
  const provider = hookProvider(body?.['provider']);
  if (!agent || !provider || typeof body?.['expectedAfterHash'] !== 'string' || typeof body?.['registeredAt'] !== 'string') {
    return context.json({ error: 'agent, provider, expectedAfterHash, and registeredAt are required' }, 400);
  }
  if (body['approved'] !== true) return context.json({ error: 'Explicit approval is required' }, 400);
  try {
    return context.json(await applyHookBridge(agent, {
      approved: true,
      expectedAfterHash: body['expectedAfterHash'],
      registeredAt: body['registeredAt'],
    }, {
      provider,
      dispatcherCommand: hookDispatcher(agent, provider),
    }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Hook Bridge apply failed' }, 409);
  }
});

app.post('/api/integrations/hooks/codex/preview', async (context) => {
  return context.json(await previewCodexHookConnection({
    dispatcherCommand: hookDispatcher('codex', 'tokray-native'),
  }));
});

app.get('/api/integrations/hooks/codex/status', async (context) => {
  return context.json(await inspectCodexHookRuntime({
    dispatcherCommand: hookDispatcher('codex', 'tokray-native'),
  }));
});

app.post('/api/integrations/hooks/codex/self-test', async (context) => {
  return context.json(await selfTestCodexHook({
    dispatcherCommand: hookDispatcher('codex', 'tokray-native'),
  }));
});

app.post('/api/integrations/hooks/codex/apply', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (body?.['approved'] !== true) return context.json({ error: 'Explicit approval is required' }, 400);
  if (typeof body['expectedAfterHash'] !== 'string') {
    return context.json({ error: 'expectedAfterHash is required' }, 400);
  }
  try {
    return context.json(await applyCodexHookConnection({
      approved: true,
      expectedAfterHash: body['expectedAfterHash'],
    }, {
      dispatcherCommand: hookDispatcher('codex', 'tokray-native'),
    }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Codex Hook connection failed' }, 409);
  }
});

app.post('/api/governance/receipts/:receiptId/rollback', async (context) => {
  const body = await context.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (body?.['approved'] !== true) return context.json({ error: 'Explicit approval is required' }, 400);
  try {
    return context.json(await rollbackHookBridge(context.req.param('receiptId'), { approved: true }));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Rollback failed' }, 409);
  }
});

app.get('/api/events', (context) => streamSSE(context, async (stream) => {
  let latest: SessionDiscoveryChange | undefined;
  let wake: (() => void) | undefined;
  const unsubscribe = subscribeSessionDiscovery((change) => {
    discoveryCache = undefined;
    latest = change;
    wake?.();
    wake = undefined;
  });
  stream.onAbort(() => {
    unsubscribe();
    wake?.();
    wake = undefined;
  });

  await stream.writeSSE({ event: 'connected', data: JSON.stringify({ at: Date.now() }), retry: 2_000 });
  try {
    while (!stream.aborted) {
      await Promise.race([
        new Promise<void>((resolve) => { wake = resolve; }),
        stream.sleep(20_000),
      ]);
      wake = undefined;
      if (stream.aborted) break;
      const change = latest;
      latest = undefined;
      if (change) {
        await stream.writeSSE({
          event: 'sessions-changed',
          id: String(change.generation),
          data: JSON.stringify(change),
        });
      } else {
        await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ at: Date.now() }) });
      }
    }
  } finally {
    unsubscribe();
  }
}));

app.get('/api/sessions', async (context) => {
  const sessions = await localSessions(context.req.query('refresh') === '1');
  return context.json(sessions.map(({ path: _path, ...session }) => session));
});

app.get('/api/analyses/:sessionId', async (context) => {
  const sessionId = context.req.param('sessionId');
  const sessions = await localSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return context.json({ error: 'Session not found' }, 404);
  try {
    return context.json(await sessionAnalysis(session));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Analysis failed' }, 422);
  }
});

app.get('/api/analyses/:sessionId/frames/:seq/conversation', async (context) => {
  const sessionId = context.req.param('sessionId');
  const seq = Number(context.req.param('seq'));
  if (!Number.isInteger(seq) || seq < 1) return context.json({ error: 'Invalid frame' }, 400);
  const sessions = await localSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return context.json({ error: 'Session not found' }, 404);
  try {
    const report = await sessionAnalysis(session);
    return context.json(await readFrameConversation(session, report, seq));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Content read failed' }, 422);
  }
});

app.get('/api/analyses/:sessionId/conversation', async (context) => {
  const sessionId = context.req.param('sessionId');
  const sessions = await localSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return context.json({ error: 'Session not found' }, 404);
  try {
    const report = await sessionAnalysis(session);
    return context.json(await readSessionConversation(session, report));
  } catch (error) {
    return context.json({ error: error instanceof Error ? error.message : 'Content read failed' }, 422);
  }
});

app.post('/api/cache/clear', (context) => {
  analysisCache.clear();
  pendingAnalyses.clear();
  invalidateSessionDiscovery();
  discoveryCache = undefined;
  return context.json({ ok: true });
});

const here = fileURLToPath(new URL('.', import.meta.url));
const webRoot = resolve(here, '../web-dist');
if (process.env['TOKRAY_WEB_DEV'] !== '1') {
  app.use('/*', serveStatic({ root: webRoot }));
  app.get('*', serveStatic({ path: resolve(webRoot, 'index.html') }));
}

export function startWebServer(options: WebServerOptions = {}) {
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 4319;
  hookCommandPrefix = options.hookCommandPrefix?.trim() || 'tokray';
  return serve({ fetch: app.fetch, hostname, port });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env['PORT']) || (process.env['TOKRAY_WEB_DEV'] === '1' ? 4320 : 4319);
  startWebServer({ port });
  console.log(`Tokray web listening on http://127.0.0.1:${port}`);
}
