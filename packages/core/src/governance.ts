import type { AgentCapability, GovernanceMode, PolicyDefinition } from './types.js';

/** Canonical order for capability matrices, adapters, APIs, and the UI. */
export const AGENT_CAPABILITY_KEYS: readonly AgentCapability[] = [
  'readLogs',
  'exactUsage',
  'exactRequest',
  'compactionMarkers',
  'preToolHook',
  'rewriteOutput',
  'toolAllowlist',
  'modelRouting',
  'compactionControl',
];

export const GOVERNANCE_MODES: readonly GovernanceMode[] = [
  'observe',
  'suggest',
  'approve',
  'enforce',
];

/** Compile-time checked, JSON-serializable policy definition for SDK users. */
export function definePolicy<const T extends PolicyDefinition>(policy: T): T {
  return policy;
}
