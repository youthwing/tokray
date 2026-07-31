import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { governNativeRequest } from './request-governor.js';
import type {
  NativeRequestGovernanceOptions,
  NativeRequestGovernanceResult,
  NativeRequestProvider,
} from './request-governor.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface ModelGatewayOptions {
  upstreamBaseUrl: string;
  hostname?: string;
  port?: number;
  maxRequestBytes?: number;
  requestTimeoutMs?: number;
  governance?: NativeRequestGovernanceOptions;
  fetchImplementation?: typeof fetch;
  onEvent?: (event: ModelGatewayEvent) => void;
}

export interface ModelGatewayGovernanceSummary {
  requestProvider: NativeRequestProvider;
  changed: boolean;
  estimatedSavedTokens: number;
  reductionPercentage: number;
  budgetStatus: NativeRequestGovernanceResult['budget']['status'];
  toolResultsCompacted: number;
}

export interface ModelGatewayEvent {
  requestId: string;
  at: string;
  method: string;
  path: string;
  status: 'forwarded' | 'blocked' | 'failed';
  durationMs: number;
  responseStatus: number;
  requestBytes: number;
  responseBytes: number;
  governance?: ModelGatewayGovernanceSummary;
  error?: string;
}

export interface ModelGatewayStats {
  startedAt: string;
  requests: number;
  forwarded: number;
  governed: number;
  blocked: number;
  failed: number;
  requestBytes: number;
  responseBytes: number;
  estimatedSavedTokens: number;
}

export interface ModelGateway {
  hostname: string;
  port: number;
  url: string;
  upstreamBaseUrl: string;
  server: Server;
  stats(): ModelGatewayStats;
  close(): Promise<void>;
}

class GatewayRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function validatedUpstream(value: string): URL {
  let result: URL;
  try {
    result = new URL(value);
  } catch {
    throw new Error('upstreamBaseUrl must be a valid absolute URL');
  }
  if (result.protocol !== 'http:' && result.protocol !== 'https:') {
    throw new Error('upstreamBaseUrl must use http or https');
  }
  result.hash = '';
  result.search = '';
  return result;
}

function upstreamUrl(base: URL, requestUrl: string): URL {
  const incoming = new URL(requestUrl, 'http://tokray.local');
  const result = new URL(base);
  const prefix = result.pathname.replace(/\/$/, '');
  result.pathname = `${prefix}${incoming.pathname.startsWith('/') ? incoming.pathname : `/${incoming.pathname}`}`;
  result.search = incoming.search;
  return result;
}

function requestHeaders(input: IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-tokray-')) continue;
    if (Array.isArray(value)) {
      for (const item of value) output.append(name, item);
    } else {
      output.set(name, value);
    }
  }
  return output;
}

function isJsonRequest(request: IncomingMessage): boolean {
  const contentType = request.headers['content-type']?.toLowerCase() ?? '';
  return contentType.includes('application/json') || contentType.includes('+json');
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new GatewayRequestError(413, `Request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function governanceSummary(result: NativeRequestGovernanceResult): ModelGatewayGovernanceSummary {
  return {
    requestProvider: result.requestProvider,
    changed: result.changed,
    estimatedSavedTokens: result.estimatedSavedTokens,
    reductionPercentage: result.reductionPercentage,
    budgetStatus: result.budget.status,
    toolResultsCompacted: result.toolResults.compacted,
  };
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): number {
  const content = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(content.length),
    ...headers,
  });
  response.end(content);
  return content.length;
}

async function streamResponse(source: Response, target: ServerResponse): Promise<number> {
  const headers: Record<string, string> = {};
  source.headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(normalized) && normalized !== 'content-encoding') headers[name] = value;
  });
  target.writeHead(source.status, headers);
  if (!source.body) {
    target.end();
    return 0;
  }
  let bytes = 0;
  const reader = source.body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (!target.write(Buffer.from(chunk.value))) await once(target, 'drain');
    }
    target.end();
  } finally {
    reader.releaseLock();
  }
  return bytes;
}

function requestMethodHasBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export async function startModelGateway(options: ModelGatewayOptions): Promise<ModelGateway> {
  const upstream = validatedUpstream(options.upstreamBaseUrl);
  const hostname = options.hostname ?? '127.0.0.1';
  const requestedPort = options.port ?? 4318;
  const maxRequestBytes = options.maxRequestBytes ?? 2_500_000;
  const timeoutMs = options.requestTimeoutMs ?? 120_000;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error('port must be between 0 and 65535');
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes <= 0) throw new Error('maxRequestBytes must be a positive integer');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('requestTimeoutMs must be a positive integer');
  const fetchUpstream = options.fetchImplementation ?? fetch;
  const current: ModelGatewayStats = {
    startedAt: new Date().toISOString(),
    requests: 0,
    forwarded: 0,
    governed: 0,
    blocked: 0,
    failed: 0,
    requestBytes: 0,
    responseBytes: 0,
    estimatedSavedTokens: 0,
  };

  const record = (event: ModelGatewayEvent): void => {
    current.requests++;
    current.requestBytes += event.requestBytes;
    current.responseBytes += event.responseBytes;
    if (event.status === 'forwarded') current.forwarded++;
    if (event.status === 'blocked') current.blocked++;
    if (event.status === 'failed') current.failed++;
    if (event.governance?.changed) current.governed++;
    current.estimatedSavedTokens += event.governance?.estimatedSavedTokens ?? 0;
    try {
      options.onEvent?.(event);
    } catch {
      /* Metrics observers must not affect the model request. */
    }
  };

  const server = createServer(async (request, response) => {
    const started = performance.now();
    const requestId = randomUUID();
    const method = request.method?.toUpperCase() ?? 'GET';
    const path = request.url ?? '/';
    if (method === 'GET' && path.split('?')[0] === '/__tokray/health') {
      json(response, 200, {
        ok: true,
        service: 'tokray-model-gateway',
        upstream: `${upstream.origin}${upstream.pathname.replace(/\/$/, '')}`,
        startedAt: current.startedAt,
      });
      return;
    }
    if (method === 'GET' && path.split('?')[0] === '/__tokray/stats') {
      json(response, 200, { ...current });
      return;
    }

    let requestBytes = 0;
    let responseBytes = 0;
    let governance: ModelGatewayGovernanceSummary | undefined;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(new Error(`Upstream request timed out after ${timeoutMs} ms`)), timeoutMs);
    request.once('aborted', () => abort.abort(new Error('Client aborted the request')));
    response.once('close', () => {
      if (!response.writableEnded) abort.abort(new Error('Client closed the response'));
    });
    try {
      const originalBody = requestMethodHasBody(method) ? await readRequestBody(request, maxRequestBytes) : Buffer.alloc(0);
      requestBytes = originalBody.length;
      let outgoingBody = originalBody;
      if (originalBody.length > 0 && isJsonRequest(request)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(originalBody.toString('utf8')) as unknown;
        } catch {
          throw new GatewayRequestError(400, 'Model request body must be valid JSON');
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new GatewayRequestError(400, 'Model request body must be a JSON object');
        }
        const governed = governNativeRequest(parsed as Record<string, unknown>, options.governance);
        governance = governanceSummary(governed);
        if (!governed.budget.sendAllowed) {
          responseBytes = json(response, 422, {
            error: {
              type: 'tokray_input_budget_exceeded',
              code: 'tokray_input_budget_exceeded',
              message: 'Tokray blocked the request because its governed input estimate exceeds the configured budget.',
            },
            requestId,
            governance,
          }, {
            'x-tokray-request-id': requestId,
            'x-tokray-governed': String(governance.changed),
          });
          record({
            requestId,
            at: new Date().toISOString(),
            method,
            path,
            status: 'blocked',
            durationMs: Number((performance.now() - started).toFixed(2)),
            responseStatus: 422,
            requestBytes,
            responseBytes,
            governance,
          });
          return;
        }
        if (governed.changed) outgoingBody = Buffer.from(JSON.stringify(governed.request));
      }

      const headers = requestHeaders(request.headers);
      if (outgoingBody.length > 0) headers.set('content-length', String(outgoingBody.length));
      const upstreamResponse = await fetchUpstream(upstreamUrl(upstream, path), {
        method,
        headers,
        ...(requestMethodHasBody(method) && outgoingBody.length > 0 ? { body: outgoingBody } : {}),
        signal: abort.signal,
        redirect: 'manual',
      });
      response.setHeader('x-tokray-request-id', requestId);
      response.setHeader('x-tokray-governed', String(governance?.changed ?? false));
      if (governance) response.setHeader('x-tokray-estimated-saved-tokens', String(governance.estimatedSavedTokens));
      responseBytes = await streamResponse(upstreamResponse, response);
      record({
        requestId,
        at: new Date().toISOString(),
        method,
        path,
        status: 'forwarded',
        durationMs: Number((performance.now() - started).toFixed(2)),
        responseStatus: upstreamResponse.status,
        requestBytes,
        responseBytes,
        ...(governance ? { governance } : {}),
      });
    } catch (error) {
      const status = error instanceof GatewayRequestError ? error.status : 502;
      const message = error instanceof Error ? error.message : 'Model gateway request failed';
      if (!response.headersSent) {
        responseBytes = json(response, status, {
          error: { type: 'tokray_gateway_error', code: 'tokray_gateway_error', message },
          requestId,
        }, { 'x-tokray-request-id': requestId });
      } else if (!response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined);
      }
      record({
        requestId,
        at: new Date().toISOString(),
        method,
        path,
        status: 'failed',
        durationMs: Number((performance.now() - started).toFixed(2)),
        responseStatus: status,
        requestBytes,
        responseBytes,
        ...(governance ? { governance } : {}),
        error: message,
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Model gateway did not bind a TCP port');
  const port = address.port;
  return {
    hostname,
    port,
    url: `http://${hostname}:${port}`,
    upstreamBaseUrl: `${upstream.origin}${upstream.pathname.replace(/\/$/, '')}`,
    server,
    stats: () => ({ ...current }),
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
