import { watch } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';
import { detectAdapter } from '@tokray/adapters';
import { contentHash } from '@tokray/core';
import { defaultParsedSessionRoots } from './agent-sources.js';
import { loadTokrayConfiguration } from './config.js';
import type { ConfiguredSessionSource, TokrayRuntimeConfiguration } from './config.js';
import type { LocalSession } from './types.js';

interface Candidate {
  path: string;
  modifiedAt: number;
  bytes: number;
  hintKey: string;
  source?: ConfiguredSessionSource;
}

type IndexedSession = LocalSession & { path: string };
interface IndexedCandidate extends Candidate {
  session?: IndexedSession;
}

export interface SessionDiscoveryChange {
  generation: number;
  at: number;
}

type SessionDiscoveryListener = (change: SessionDiscoveryChange) => void;

const candidateIndex = new Map<string, IndexedCandidate>();
let cachedSessions: IndexedSession[] = [];
let dirty = true;
let generation = 0;
let refreshPromise: Promise<void> | undefined;
const changeListeners = new Set<SessionDiscoveryListener>();
const watchers = new Map<string, ReturnType<typeof watch>>();

function markDirty(): void {
  dirty = true;
  generation++;
  const change = { generation, at: Date.now() };
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch {
      // A UI subscriber must never break filesystem invalidation.
    }
  }
}

function ensureWatchers(paths: readonly string[]): void {
  for (const root of paths) {
    if (watchers.has(root)) continue;
    try {
      const watcher = watch(root, { recursive: true }, markDirty);
      watcher.on('error', markDirty);
      watcher.unref();
      watchers.set(root, watcher);
    } catch {
      // Missing roots are normal; an explicit refresh discovers them later.
    }
  }
}

function supportedCandidate(path: string): boolean {
  return ['.jsonl', '.ndjson', '.json'].includes(extname(path).toLocaleLowerCase());
}

function hintKey(source: ConfiguredSessionSource | undefined): string {
  return source ? `${source.origin}\u0000${source.agent ?? ''}\u0000${source.adapter ?? ''}` : 'built-in';
}

async function addCandidate(path: string, out: Candidate[], source?: ConfiguredSessionSource): Promise<void> {
  if (!supportedCandidate(path)) return;
  try {
    const info = await stat(path);
    if (info.isFile()) out.push({ path, modifiedAt: info.mtimeMs, bytes: info.size, hintKey: hintKey(source), ...(source ? { source } : {}) });
  } catch {
    // Ignore files removed during discovery.
  }
}

async function walk(dir: string, out: Candidate[], source?: ConfiguredSessionSource): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out, source);
    } else if (entry.isFile()) {
      await addCandidate(path, out, source);
    }
  }
}

async function collectRoot(path: string, out: Candidate[], source?: ConfiguredSessionSource): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) await walk(path, out, source);
    else if (info.isFile()) await addCandidate(path, out, source);
  } catch {
    // Missing configured/default roots are normal.
  }
}

async function probe(path: string): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function titleFor(path: string, adapter: string): string {
  if (adapter === 'claude-code') {
    const project = basename(dirname(path)).replace(/^-/, '').replaceAll('-', '/');
    return project.length > 38 ? `...${project.slice(-35)}` : project;
  }
  const stamp = basename(path).match(/rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/i)?.[1];
  return stamp ? stamp.replace('T', ' ') : basename(path, '.jsonl');
}

async function indexCandidate(candidate: Candidate, runtime: TokrayRuntimeConfiguration): Promise<IndexedCandidate> {
  const home = homedir();
  try {
    const sourceProbe = { head: await probe(candidate.path), name: candidate.path, byteLength: candidate.bytes };
    const preferred = candidate.source?.adapter
      ? runtime.adapters.find((adapter) => adapter.id === candidate.source?.adapter)
      : undefined;
    const adapter = preferred?.detect(sourceProbe).match ? preferred : detectAdapter(sourceProbe, runtime.adapters);
    if (!adapter) return candidate;
    const agent = candidate.source?.agent ?? runtime.adapterAgents.get(adapter.id) ?? adapter.id;
    return {
      ...candidate,
      session: {
        id: contentHash(candidate.path),
        adapter: adapter.id,
        agent,
        title: titleFor(candidate.path, adapter.id),
        location: `~/${relative(home, candidate.path)}`,
        modifiedAt: candidate.modifiedAt,
        bytes: candidate.bytes,
        path: candidate.path,
      },
    };
  } catch {
    return candidate;
  }
}

async function refreshIndex(): Promise<void> {
  const scanGeneration = generation;
  const runtime = await loadTokrayConfiguration();
  const roots = defaultParsedSessionRoots();
  ensureWatchers([...roots, ...runtime.sources.map((source) => source.path), ...runtime.files]);
  const discovered: Candidate[] = [];
  for (const root of roots) await collectRoot(root, discovered);
  for (const source of runtime.sources) await collectRoot(source.path, discovered, source);
  const candidates = [...new Map(discovered.map((candidate) => [candidate.path, candidate])).values()];
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const next = new Map<string, IndexedCandidate>();
  const changed: Candidate[] = [];
  for (const candidate of candidates) {
    const previous = candidateIndex.get(candidate.path);
    if (previous && previous.modifiedAt === candidate.modifiedAt && previous.bytes === candidate.bytes && previous.hintKey === candidate.hintKey) {
      next.set(candidate.path, previous);
    } else {
      changed.push(candidate);
    }
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(12, changed.length) }, async () => {
    while (cursor < changed.length) {
      const candidate = changed[cursor++];
      if (!candidate) break;
      next.set(candidate.path, await indexCandidate(candidate, runtime));
    }
  });
  await Promise.all(workers);
  candidateIndex.clear();
  for (const [path, candidate] of next) candidateIndex.set(path, candidate);
  cachedSessions = [...candidateIndex.values()]
    .flatMap((candidate) => candidate.session ? [candidate.session] : [])
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  dirty = generation !== scanGeneration;
}

export function invalidateSessionDiscovery(): void {
  markDirty();
}

/** Subscribe to coarse filesystem/index invalidations. Events may be coalesced by consumers. */
export function subscribeSessionDiscovery(listener: SessionDiscoveryListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export async function discoverSessions(limit = Number.POSITIVE_INFINITY): Promise<IndexedSession[]> {
  if (dirty) {
    refreshPromise ??= refreshIndex().finally(() => { refreshPromise = undefined; });
    await refreshPromise;
  }
  return Number.isFinite(limit) ? cachedSessions.slice(0, Math.max(0, limit)) : cachedSessions.slice();
}
