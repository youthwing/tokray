import { access } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type AgentSourceAccess = 'parsed' | 'adapter-required' | 'opaque';

export interface AgentSourceProfile {
  id: string;
  agent: string;
  label: string;
  access: AgentSourceAccess;
  paths: readonly string[];
  note: string;
}

export interface AgentSourceStatus extends AgentSourceProfile {
  availablePaths: string[];
  available: boolean;
}

export interface AgentSourceEnvironment {
  home?: string;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
}

function editorStoragePaths(app: string, environment: Required<AgentSourceEnvironment>): string[] {
  const { home, platform: os, env } = environment;
  if (os === 'darwin') return [join(home, 'Library', 'Application Support', app, 'User')];
  if (os === 'win32') return [join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), app, 'User')];
  return [join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), app, 'User')];
}

export function agentSourceProfiles(input: AgentSourceEnvironment = {}): AgentSourceProfile[] {
  const environment: Required<AgentSourceEnvironment> = {
    home: input.home ?? homedir(),
    platform: input.platform ?? platform(),
    env: input.env ?? process.env,
  };
  const { home } = environment;
  const code = editorStoragePaths('Code', environment);
  const cursor = editorStoragePaths('Cursor', environment);
  const windsurf = editorStoragePaths('Windsurf', environment);
  const trae = editorStoragePaths('Trae', environment);
  const traeCn = editorStoragePaths('Trae CN', environment);
  const codeBuddy = editorStoragePaths('CodeBuddy', environment);
  const extensionRoots = [...code, ...cursor, ...windsurf];
  return [
    {
      id: 'claude-code',
      agent: 'claude-code',
      label: 'Claude Code',
      access: 'parsed',
      paths: [join(home, '.claude', 'projects')],
      note: 'JSONL sessions with model usage and compaction markers.',
    },
    {
      id: 'codex',
      agent: 'codex',
      label: 'Codex',
      access: 'parsed',
      paths: [join(home, '.codex', 'sessions'), join(home, '.codex', 'archived_sessions')],
      note: 'JSONL rollout sessions with token_count events.',
    },
    {
      id: 'raw-request',
      agent: 'raw-request',
      label: 'OpenAI / Anthropic capture',
      access: 'parsed',
      paths: [join(home, '.tokray', 'captures')],
      note: 'Tokray model_call JSONL capture directory.',
    },
    {
      id: 'cursor',
      agent: 'cursor',
      label: 'Cursor',
      access: 'opaque',
      paths: cursor.flatMap((path) => [join(path, 'globalStorage', 'state.vscdb'), join(path, 'workspaceStorage')]),
      note: 'Local stores are detectable; a verified SQLite/state adapter is still required.',
    },
    {
      id: 'cline',
      agent: 'cline',
      label: 'Cline',
      access: 'adapter-required',
      paths: extensionRoots.map((path) => join(path, 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')),
      note: 'Task history is file-based but needs a dedicated multi-file adapter.',
    },
    {
      id: 'roo-code',
      agent: 'roo-code',
      label: 'Roo Code',
      access: 'adapter-required',
      paths: extensionRoots.map((path) => join(path, 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks')),
      note: 'Task history is file-based but needs a dedicated multi-file adapter.',
    },
    {
      id: 'continue',
      agent: 'continue',
      label: 'Continue',
      access: 'adapter-required',
      paths: [join(home, '.continue', 'sessions')],
      note: 'Session exports vary by Continue version and require format fixtures.',
    },
    {
      id: 'windsurf',
      agent: 'windsurf',
      label: 'Windsurf',
      access: 'opaque',
      paths: windsurf.flatMap((path) => [join(path, 'globalStorage', 'state.vscdb'), join(path, 'workspaceStorage')]),
      note: 'VS Code-derived storage is detectable; exact request visibility is not assumed.',
    },
    {
      id: 'gemini-cli',
      agent: 'gemini-cli',
      label: 'Gemini CLI',
      access: 'adapter-required',
      paths: [join(home, '.gemini', 'tmp')],
      note: 'Chat files require a verified versioned adapter before analysis.',
    },
    {
      id: 'codebuddy',
      agent: 'codebuddy',
      label: 'CodeBuddy',
      access: 'opaque',
      paths: codeBuddy.flatMap((path) => [join(path, 'globalStorage', 'state.vscdb'), join(path, 'workspaceStorage')]),
      note: 'Installation can be detected; direct log and Hook capabilities still require a local fixture.',
    },
    {
      id: 'trae',
      agent: 'trae',
      label: 'Trae',
      access: 'opaque',
      paths: [...trae, ...traeCn].map((path) => join(path, '..', 'ModularData', 'ai-agent', 'database.db')),
      note: 'The observed ai-agent database is encrypted/opaque; use a verified Hook or request collector.',
    },
  ];
}

export async function inspectAgentSources(environment: AgentSourceEnvironment = {}): Promise<AgentSourceStatus[]> {
  return Promise.all(agentSourceProfiles(environment).map(async (profile) => {
    const availablePaths: string[] = [];
    for (const path of profile.paths) {
      try {
        await access(path);
        availablePaths.push(path);
      } catch {
        // Missing installations are expected.
      }
    }
    return { ...profile, availablePaths, available: availablePaths.length > 0 };
  }));
}

export function defaultParsedSessionRoots(environment: AgentSourceEnvironment = {}): string[] {
  return agentSourceProfiles(environment)
    .filter((profile) => profile.access === 'parsed')
    .flatMap((profile) => [...profile.paths]);
}
