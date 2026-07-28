import { heuristicTokenEstimator } from '@tokray/core';
import type { Adapter } from '@tokray/core';
import { detectClaudeCode } from './detect.js';
import { parseClaudeCode } from './parse.js';
import { schemaPrior } from './priors.js';

export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  // Verified against logs written by Claude Code 2.x in July 2026.
  schemaRange: '>=2 <3',
  capabilities: {
    accounting: 'usage-calibrated',
    exactSystemPrompt: false,
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
  schemaPricer: { price: schemaPrior },
  detect: detectClaudeCode,
  parse: parseClaudeCode,
};
