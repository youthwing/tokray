import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  adapters as builtInAdapters,
  createDeclarativeAdapter,
  validateDeclarativeAdapterDefinition,
} from '@tokray/adapters';
import type { DeclarativeAdapterDefinition } from '@tokray/adapters';
import type { Adapter } from '@tokray/core';

type Obj = Record<string, unknown>;

export interface ConfiguredSessionSource {
  path: string;
  origin: string;
  agent?: string;
  adapter?: string;
}

export interface TokrayConfigIssue {
  file: string;
  path: string;
  message: string;
}

export interface TokrayRuntimeConfiguration {
  files: string[];
  sources: ConfiguredSessionSource[];
  adapters: readonly Adapter[];
  adapterAgents: ReadonlyMap<string, string>;
  issues: TokrayConfigIssue[];
}

export interface LoadTokrayConfigurationOptions {
  cwd?: string;
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  configPaths?: readonly string[];
}

const object = (value: unknown): Obj | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;

function environmentValue(name: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env[name];
}

export function expandConfiguredPath(
  value: string,
  baseDirectory: string,
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  let expanded = value === '~' ? home : value.startsWith('~/') || value.startsWith('~\\') ? join(home, value.slice(2)) : value;
  expanded = expanded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/g, (token, braced: string | undefined, bare: string | undefined, windows: string | undefined) => {
    const name = braced ?? bare ?? windows;
    return name ? environmentValue(name, env) ?? token : token;
  });
  return resolve(isAbsolute(expanded) ? expanded : join(baseDirectory, expanded));
}

function defaultConfigPaths(cwd: string, home: string, env: Readonly<Record<string, string | undefined>>): string[] {
  const explicit = env['TOKRAY_CONFIG'];
  if (explicit) return [expandConfiguredPath(explicit, cwd, home, env)];
  const paths = [join(home, '.config', 'tokray', 'config.json')];
  const appData = env['APPDATA'];
  if (appData) paths.push(join(appData, 'Tokray', 'config.json'));
  paths.push(join(cwd, 'tokray.config.json'));
  return [...new Set(paths)];
}

async function readConfigFile(path: string): Promise<{ exists: boolean; value?: unknown; error?: string }> {
  try {
    const source = await readFile(path, 'utf8');
    try {
      return { exists: true, value: JSON.parse(source) as unknown };
    } catch (error) {
      return { exists: true, error: error instanceof Error ? error.message : 'invalid JSON' };
    }
  } catch (error) {
    const code = object(error)?.['code'];
    if (code === 'ENOENT') return { exists: false };
    return { exists: true, error: error instanceof Error ? error.message : 'read failed' };
  }
}

export async function loadTokrayConfiguration(
  options: LoadTokrayConfigurationOptions = {},
): Promise<TokrayRuntimeConfiguration> {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const configPaths = options.configPaths
    ? options.configPaths.map((path) => expandConfiguredPath(path, cwd, home, env))
    : defaultConfigPaths(cwd, home, env);
  const files: string[] = [];
  const sources: ConfiguredSessionSource[] = [];
  const issues: TokrayConfigIssue[] = [];
  const adapters: Adapter[] = [...builtInAdapters];
  const adapterAgents = new Map<string, string>();
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));

  for (const path of configPaths) {
    const loaded = await readConfigFile(path);
    if (!loaded.exists) continue;
    files.push(path);
    if (loaded.error) {
      issues.push({ file: path, path: '', message: loaded.error });
      continue;
    }
    const config = object(loaded.value);
    if (!config) {
      issues.push({ file: path, path: '', message: 'configuration root must be an object' });
      continue;
    }
    if (config['version'] !== 1) issues.push({ file: path, path: '/version', message: 'must equal 1' });
    const sourceValues = config['sources'];
    if (sourceValues !== undefined && !Array.isArray(sourceValues)) {
      issues.push({ file: path, path: '/sources', message: 'must be an array' });
    }
    for (const [index, sourceValue] of (Array.isArray(sourceValues) ? sourceValues : []).entries()) {
      const source = object(sourceValue);
      if (typeof source?.['path'] !== 'string' || source['path'].trim().length === 0) {
        issues.push({ file: path, path: `/sources/${index}/path`, message: 'must be a non-empty string' });
        continue;
      }
      const configured: ConfiguredSessionSource = {
        path: expandConfiguredPath(source['path'], dirname(path), home, env),
        origin: path,
      };
      if (typeof source['agent'] === 'string' && source['agent'].length > 0) configured.agent = source['agent'];
      if (typeof source['adapter'] === 'string' && source['adapter'].length > 0) configured.adapter = source['adapter'];
      sources.push(configured);
    }
    const definitions = config['adapters'];
    if (definitions !== undefined && !Array.isArray(definitions)) {
      issues.push({ file: path, path: '/adapters', message: 'must be an array' });
    }
    for (const [index, definition] of (Array.isArray(definitions) ? definitions : []).entries()) {
      const definitionIssues = validateDeclarativeAdapterDefinition(definition);
      if (definitionIssues.length > 0) {
        for (const issue of definitionIssues) {
          issues.push({ file: path, path: `/adapters/${index}${issue.path}`, message: issue.message });
        }
        continue;
      }
      const typed = definition as DeclarativeAdapterDefinition;
      if (adapterIds.has(typed.id)) {
        issues.push({ file: path, path: `/adapters/${index}/id`, message: `duplicate adapter id ${typed.id}` });
        continue;
      }
      adapters.push(createDeclarativeAdapter(typed));
      adapterIds.add(typed.id);
      adapterAgents.set(typed.id, typed.agent);
    }
  }
  for (const source of sources) {
    if (source.adapter && !adapterIds.has(source.adapter)) {
      issues.push({ file: source.origin, path: '/sources', message: `unknown adapter id ${source.adapter}` });
    }
  }
  return { files, sources, adapters, adapterAgents, issues };
}
