import type { ActionExecutionTarget, GovernanceRisk } from '@tokray/core';

export type NativeGovernanceSurface =
  | 'tool-output'
  | 'context-selection'
  | 'tool-schema'
  | 'memory'
  | 'request-prefix'
  | 'compaction'
  | 'workflow';

export type NativeStrategyMaturity = 'available' | 'diagnose' | 'planned';

export interface NativeGovernanceStrategy {
  id: string;
  surface: NativeGovernanceSurface;
  maturity: NativeStrategyMaturity;
  target: ActionExecutionTarget;
  risk: GovernanceRisk;
  reversible: boolean;
  evidence: readonly string[];
}

const strategies: readonly NativeGovernanceStrategy[] = [
  {
    id: 'output.filter',
    surface: 'tool-output',
    maturity: 'available',
    target: 'tool-hook',
    risk: 'low',
    reversible: true,
    evidence: ['raw-output', 'compact-output', 'exit-code', 'bytes', 'lines'],
  },
  {
    id: 'context.progressive-disclosure',
    surface: 'context-selection',
    maturity: 'planned',
    target: 'request-proxy',
    risk: 'medium',
    reversible: true,
    evidence: ['block-source', 'reference-lifecycle', 'retrieval-path'],
  },
  {
    id: 'context.deduplicate',
    surface: 'context-selection',
    maturity: 'diagnose',
    target: 'request-proxy',
    risk: 'low',
    reversible: true,
    evidence: ['content-hash', 'source-ref', 'same-frame-copies'],
  },
  {
    id: 'tools.schema-gating',
    surface: 'tool-schema',
    maturity: 'diagnose',
    target: 'agent-config',
    risk: 'medium',
    reversible: true,
    evidence: ['loaded-tools', 'called-tools', 'schema-token-prior'],
  },
  {
    id: 'memory.externalize',
    surface: 'memory',
    maturity: 'diagnose',
    target: 'request-proxy',
    risk: 'medium',
    reversible: true,
    evidence: ['resident-frames', 'last-reference', 'source-ref'],
  },
  {
    id: 'cache.stable-prefix',
    surface: 'request-prefix',
    maturity: 'diagnose',
    target: 'request-proxy',
    risk: 'low',
    reversible: true,
    evidence: ['cache-read', 'uncached-input', 'model-boundary'],
  },
  {
    id: 'compaction.protect',
    surface: 'compaction',
    maturity: 'diagnose',
    target: 'agent-control',
    risk: 'medium',
    reversible: true,
    evidence: ['block-fate', 'summary-coverage', 'critical-identifiers'],
  },
  {
    id: 'workflow.deterministic-offload',
    surface: 'workflow',
    maturity: 'planned',
    target: 'tokray',
    risk: 'medium',
    reversible: true,
    evidence: ['repeated-tool-sequence', 'deterministic-step', 'model-call-boundary'],
  },
];

export function nativeGovernanceStrategies(): readonly NativeGovernanceStrategy[] {
  return strategies;
}
