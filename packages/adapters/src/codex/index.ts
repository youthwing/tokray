import { heuristicTokenEstimator } from '@tokray/core';
import type { Adapter } from '@tokray/core';
import { defineAdapter } from '../sdk.js';
import { detectCodex } from './detect.js';
import { parseCodex } from './parse.js';

export const codexAdapter: Adapter = defineAdapter({
  id: 'codex',
  schemaRange: 'Codex rollout JSONL 2026-03+',
  capabilities: {
    accounting: 'usage-calibrated',
    exactSystemPrompt: true,
    exactToolSchemas: false,
    exactUsage: true,
    compaction: 'marker',
  },
  agentCapabilities: {
    readLogs: 'full',
    exactUsage: 'full',
    exactRequest: 'partial',
    compactionMarkers: 'full',
    preToolHook: 'unknown',
    rewriteOutput: 'unknown',
    toolAllowlist: 'unknown',
    modelRouting: 'unknown',
    compactionControl: 'unknown',
  },
  tokenEstimator: heuristicTokenEstimator,
  detect: detectCodex,
  parse: parseCodex,
});
