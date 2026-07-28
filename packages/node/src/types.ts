import type {
  ActionProposal,
  AdapterCapabilities,
  AgentCapabilities,
  Anomaly,
  Attribution,
  BlockId,
  Calibration,
  CalibrationSegment,
  CompactionEvent,
  ContentHash,
  GovernanceFinding,
  ModelIdentity,
  ProviderUsage,
  SourceRef,
  TokenCount,
  UsageSignal,
} from '@tokray/core';

export interface LocalSession {
  id: string;
  adapter: string;
  /** Agent/capture source, independent from the model provider. */
  agent: string;
  title: string;
  location: string;
  modifiedAt: number;
  bytes: number;
}

export interface AnalysisBlock {
  id: BlockId;
  attribution: Attribution;
  tokens: TokenCount;
  hash: ContentHash;
  sourceRef: SourceRef;
}

export interface AnalysisFrame {
  seq: number;
  at: number;
  model: ModelIdentity;
  totals: { input: number; cacheRead?: number; cacheWrite?: number; output?: number };
  providerUsage: ProviderUsage;
  delta: { addedTokens: number; carriedTokens: number };
  kinds: Record<string, number>;
  blocks: readonly AnalysisBlock[];
  usage: readonly UsageSignal[];
  calibration: Calibration;
  compactionRef?: number;
}

export interface UsageTotals {
  calls: number;
  input: number;
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoningOutput: number;
}

export interface ModelUsage extends UsageTotals {
  provider: string;
  model: string;
}

export interface UsageSummary {
  totals: UsageTotals;
  cacheHitRate: number;
  byModel: ModelUsage[];
  sources: Array<{ source: ProviderUsage['source']; calls: number }>;
}

export interface ConversationEntry {
  id: string;
  kind: Attribution['kind'];
  source?: string;
  tokens: number;
  record: number;
  content: string;
  truncated: boolean;
}

export type DiagnosisSeverity = GovernanceFinding['severity'];

type SessionFindingDetail =
  | { kind: 'context-peak'; severity: 'warning' | 'critical'; frameSeq: number; tokens: number; target: 'frames' }
  | { kind: 'persistent-block'; severity: 'info' | 'warning'; frameSeq: number; source: string; tokens: number; ageFrames: number; target: 'frames' }
  | { kind: 'tool-overhead'; severity: 'info' | 'warning'; source: string; tokens: number; calls: number; target: 'tools' }
  | { kind: 'duplicate-content'; severity: 'info' | 'warning'; frameSeq: number; source: string; copies: number; tokens: number; target: 'frames' }
  | { kind: 'idle-tools'; severity: 'info' | 'warning'; source: string; count: number; tokens: number; target: 'tools' }
  | { kind: 'compaction'; severity: 'info' | 'warning'; count: number; reduction: number; unobservedTokens: number; target: 'compaction' }
  | { kind: 'cache-efficiency'; severity: 'positive' | 'info' | 'warning'; percentage: number; input: number; uncachedInput: number; target: 'usage' }
  | { kind: 'low-confidence'; severity: 'warning'; count: number; frameSeq: number; target: 'overview' }
  | { kind: 'parser-issues'; severity: 'warning'; count: number; target: 'anomalies' };

export type SessionFinding = GovernanceFinding & SessionFindingDetail;

export interface SessionDiagnosis {
  verdict: 'healthy' | 'attention' | 'critical';
  issueCount: number;
  findings: SessionFinding[];
}

export interface AnalysisReport {
  session: LocalSession;
  capabilities: AdapterCapabilities;
  agentCapabilities: AgentCapabilities;
  exactTotals: boolean;
  calibration: Calibration;
  calibrationSegments: CalibrationSegment[];
  finalTokens: number;
  maxTokens: number;
  frames: AnalysisFrame[];
  compactions: CompactionEvent[];
  usage: UsageSummary;
  diagnosis: SessionDiagnosis;
  actionProposals: readonly ActionProposal[];
  /** Blocks written after the last model-call snapshot. */
  tailBlocks: readonly AnalysisBlock[];
  tools: {
    called: Array<{ name: string; server?: string; calls: number; inputTokens: number; resultTokens: number }>;
    mcpServers: Array<{ server: string; calledTools: number; calls: number; resultTokens: number; deferredTools: number; announced: boolean }>;
    loadedNeverCalled: readonly string[];
    wastedSchemaTokens: TokenCount;
    deferredNeverLoaded: readonly string[];
    residentSuspects: readonly string[];
  };
  residentBreakdown: {
    total: TokenCount;
    components: ReadonlyArray<{ label: string; tokens: TokenCount }>;
    unaccounted: TokenCount;
    overshoot: boolean;
  };
  anomalies: Anomaly[];
}
