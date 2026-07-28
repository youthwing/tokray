import { heuristicTokenEstimator } from '@tokray/core';
import type { Adapter } from '@tokray/core';
import { defineAdapter } from '../sdk.js';
import { detectRawRequest } from './detect.js';
import { parseRawRequest } from './parse.js';

export const rawRequestAdapter: Adapter = defineAdapter({
  id: 'raw-request',
  schemaRange: 'tokray model_call v1; OpenAI/Anthropic compatible request envelopes',
  capabilities: {
    accounting: 'exact-request',
    exactSystemPrompt: true,
    exactToolSchemas: true,
    exactUsage: false,
    compaction: 'none',
  },
  agentCapabilities: {
    readLogs: 'full',
    exactUsage: 'partial',
    exactRequest: 'full',
    compactionMarkers: 'none',
    preToolHook: 'none',
    rewriteOutput: 'none',
    toolAllowlist: 'none',
    modelRouting: 'none',
    compactionControl: 'none',
  },
  tokenEstimator: heuristicTokenEstimator,
  detect: detectRawRequest,
  parse: parseRawRequest,
});
