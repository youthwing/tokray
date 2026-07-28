/**
 * The Tokray context normalization contract.
 *
 * The first-class object is the ContextFrame: one model call = one frame =
 * "the messages array that was actually sent". Not a span, not a chat message.
 *
 * Two principles are enforced at the type level:
 *
 * 1. Honesty about attribution. Reconstructing someone else's context assembly
 *    logic necessarily involves inference. Every Attribution carries a
 *    confidence level; callers can never receive a guess dressed up as a fact.
 *
 * 2. Honesty about token counts. Not every count has a ground-truth source.
 *    TokenCount always states its method, and heuristic counts carry an error
 *    band. "Unknown" is a first-class state — never silently zero.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Stable identifier for a block within a session. */
export type BlockId = string & { readonly __brand: 'BlockId' };

/** Content fingerprint (FNV-1a 64 hex). First-pass filter for diffing. */
export type ContentHash = string & { readonly __brand: 'ContentHash' };

/** Agent runtime and log capabilities are independent from model providers. */
export type AgentCapability =
  | 'readLogs'
  | 'exactUsage'
  | 'exactRequest'
  | 'compactionMarkers'
  | 'preToolHook'
  | 'rewriteOutput'
  | 'toolAllowlist'
  | 'modelRouting'
  | 'compactionControl';

/**
 * full    — available for the complete supported source/runtime surface.
 * partial — available with documented gaps or only for some records/actions.
 * none    — the agent or capture format does not expose this capability.
 * unknown — not verified yet; consumers must not present an action as usable.
 */
export type CapabilitySupport = 'full' | 'partial' | 'none' | 'unknown';

export type AgentCapabilities = Readonly<Record<AgentCapability, CapabilitySupport>>;

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export type OriginKind =
  // Resident layer: present on (nearly) every call.
  | 'system'       // system prompt, injected reminders, resident overhead
  | 'tool_schema'  // tool/MCP definitions (usually absent from logs; derived)
  | 'skill'        // skill/instruction payloads
  | 'memory'       // memory files (CLAUDE.md, auto-memory)
  // Accumulating layer: grows turn by turn.
  | 'user'         // human-typed input
  | 'file_ref'     // file content placed in context
  | 'tool_result'  // tool call results
  | 'subagent'     // subagent transcripts/results
  | 'thinking'     // extended thinking (usually NOT re-sent; tracked separately)
  | 'assistant'    // prior assistant text / tool_use blocks
  | 'summary'      // compaction summaries
  | 'unknown';

export interface Attribution {
  kind: OriginKind;
  /** Second-level source: MCP server name / tool name / file path / subagent name. */
  source?: string;
  /**
   * exact    — stated directly by the source log.
   * inferred — derived from structural rules (e.g. tool_use_id matching).
   * guessed  — heuristic; UIs must visually mark it as uncertain.
   */
  confidence: 'exact' | 'inferred' | 'guessed';
  /** Human-readable justification. The product must be able to defend itself. */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// Token counts: uncertainty modeled in, not hidden
// ---------------------------------------------------------------------------

export interface TokenCount {
  value: number;
  /**
   * exact-api            — from API usage numbers.
   * tokenizer            — counted by a real tokenizer.
   * calibrated-heuristic — estimator output, anchored by per-session calibration.
   * prior                — a shipped constant for content whose text never
   *                        reaches the log (e.g. tool schemas known only by name).
   */
  method: 'exact-api' | 'tokenizer' | 'calibrated-heuristic' | 'prior';
  /** For calibrated-heuristic and prior: [low, high] bounds. */
  errorBand?: readonly [number, number];
}

// ---------------------------------------------------------------------------
// Blocks and frames
// ---------------------------------------------------------------------------

/** Where a block's raw bytes live. Content is never held in memory; sliced on demand. */
export interface SourceRef {
  /** Adapter-scoped source identity, e.g. a file path or stream id. */
  sourceId: string;
  /** Record ordinal within the source (e.g. JSONL line number, 1-based). */
  record: number;
  /**
   * RFC 6901 JSON Pointer locating the value inside the record. Adapters for
   * non-JSON sources may omit it and provide an exact byte range instead.
   */
  pointer?: string;
  /** Exact byte range in the source, when the source format exposes one. */
  byteRange?: readonly [start: number, end: number];
}

export interface UsageSignal {
  blockId: BlockId;
  /** First frame in which the block was present. */
  introducedSeq: number;
  /** Number of model calls for which the block has remained present. */
  ageFrames: number;
  /** Explicit references are optional because most logs do not expose them. */
  referenced?: boolean;
  lastReferencedSeq?: number;
}

/**
 * Compact content fingerprints computed at parse time (when the adapter still
 * holds the text) so the diff engine can align blocks WITHOUT refetching
 * content — block text is never held in memory, per the SourceRef contract.
 */
export interface BlockFeatures {
  /** Content-defined chunk hashes; a local edit perturbs only nearby chunks. */
  chunks: readonly ContentHash[];
  /** Salient identifiers (paths, symbols, rare words) for summary-coverage evidence. */
  idents: readonly string[];
}

export interface ContextBlock {
  id: BlockId;
  attribution: Attribution;
  /** Lazy, structurally addressable reference into the source record. */
  sourceRef: SourceRef;
  tokens: TokenCount;
  hash: ContentHash;
  /** Present when the adapter computed diff features; absent features degrade
   * the diff to exact-hash verdicts only — never to silent guessing. */
  features?: BlockFeatures;
  children?: readonly ContextBlock[];
}

export interface FrameDelta {
  addedTokens: number;
  carriedTokens: number;
  addedBlockIds: readonly BlockId[];
}

export interface FrameTotals {
  /** Normalized total model-visible prompt tokens for this call. */
  input: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
}

export interface ModelIdentity {
  /** API/model vendor, independent from the Agent that initiated the call. */
  provider?: string;
  model: string;
  /** Agent or capture source that initiated/logged the call. */
  agent?: string;
}

export interface ProviderUsage {
  /** Provider-reported input field before normalization. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningOutputTokens?: number;
  /** Whether inputTokens already includes cacheReadTokens/cacheWriteTokens. */
  inputAccounting: 'includes-cache' | 'excludes-cache' | 'unknown';
  source: 'api' | 'log' | 'estimated';
}

export interface ContextFrame {
  /** Ordinal of the model call within the session (1-based). */
  seq: number;
  /** Epoch ms of the call. */
  at: number;
  model: ModelIdentity;
  /** Conversation blocks the model saw for this call (resident layer excluded; derived). */
  blocks: readonly ContextBlock[];
  /** Frame-relative residency metadata; never stored on shared blocks. */
  usage: readonly UsageSignal[];
  /** Provider-native usage plus its cache accounting semantics. */
  providerUsage: ProviderUsage;
  totals: FrameTotals;
  /** Precomputed increment relative to the previous frame; UIs do no heavy work. */
  delta: FrameDelta;
  /** Set when this frame is the first after a compaction. */
  compactionRef?: number;
}

// ---------------------------------------------------------------------------
// Governance: evidence -> policy -> reversible action
// ---------------------------------------------------------------------------

export type GovernanceSeverity = 'positive' | 'info' | 'warning' | 'critical';
export type GovernanceConfidence = Attribution['confidence'];
export type GovernanceMode = 'observe' | 'suggest' | 'approve' | 'enforce';
export type GovernanceRisk = 'low' | 'medium' | 'high';

export type GovernanceScope =
  | { kind: 'session' }
  | { kind: 'frame'; frameSeq: number }
  | { kind: 'block'; frameSeq: number; blockId: BlockId }
  | { kind: 'tool'; toolName: string }
  | { kind: 'compaction'; atSeq: number }
  | { kind: 'project'; projectId: string }
  | { kind: 'agent'; agent: string }
  | { kind: 'model'; provider?: string; model: string };

export type GovernanceEvidenceRef =
  | { kind: 'source'; sourceRef: SourceRef }
  | { kind: 'frame'; frameSeq: number }
  | { kind: 'block'; frameSeq: number; blockId: BlockId; sourceRef?: SourceRef }
  | { kind: 'tool'; toolName: string }
  | { kind: 'usage'; fromSeq?: number; toSeq?: number }
  | { kind: 'compaction'; atSeq: number }
  | { kind: 'anomaly'; atRecord?: number }
  | { kind: 'calibration'; fromSeq: number; toSeq: number };

export interface GovernanceImpact {
  /** Measured or estimated tokens currently attributable to the finding. */
  currentTokens?: TokenCount;
  /** Tokens classified as avoidable by the rule, before an action is applied. */
  estimatedWasteTokens?: TokenCount;
  /** Expected reduction; it remains an estimate until an experiment verifies it. */
  estimatedSavingTokens?: TokenCount;
}

export interface GovernanceRecommendation {
  /** Stable action id resolved by an action provider, not localized UI text. */
  action: string;
  mode: GovernanceMode;
  risk: GovernanceRisk;
}

/** Provider-neutral finding contract. Rule-specific details may extend it. */
export interface GovernanceFinding {
  /** Stable rule id, e.g. context.persistent-tool-result. */
  ruleId: string;
  severity: GovernanceSeverity;
  confidence: GovernanceConfidence;
  scope: GovernanceScope;
  /** Findings without evidence are invalid and must not reach the UI. */
  evidence: readonly GovernanceEvidenceRef[];
  impact?: GovernanceImpact;
  recommendation: GovernanceRecommendation;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface PolicyScope {
  projectIds?: readonly string[];
  agents?: readonly string[];
  modelProviders?: readonly string[];
  models?: readonly string[];
  workflowIds?: readonly string[];
}

/** Serializable policy contract shared by local and self-hosted modes. */
export interface PolicyDefinition {
  version: 1;
  id: string;
  ruleId: string;
  enabled: boolean;
  mode: GovernanceMode;
  scope?: PolicyScope;
  parameters: Readonly<Record<string, JsonValue>>;
}

/** Where an approved action would be executed. Logs remain evidence-only. */
export type ActionExecutionTarget =
  | 'tokray'
  | 'agent-config'
  | 'agent-control'
  | 'tool-hook'
  | 'request-proxy';

/** Apply readiness is separate from whether a read-only preview is available. */
export type ActionAvailability =
  | 'inspect-only'
  | 'manual-only'
  | 'bridge-required'
  | 'apply-ready';

export interface ActionExecution {
  target: ActionExecutionTarget;
  availability: ActionAvailability;
  /** Runtime capability required by this action, when the Agent exposes one. */
  requiredCapability?: AgentCapability;
  capabilitySupport?: CapabilitySupport;
  /** Historical context is immutable; governance changes affect later calls. */
  appliesTo: 'current-analysis' | 'future-calls';
}

export interface ActionPreview {
  /** Preview describes the eventual action; generating the preview is always read-only. */
  writesFiles: boolean;
  changesRuntime: boolean;
  requiresApproval: boolean;
}

/** Evidence-linked, capability-aware action proposal derived from one finding. */
export interface ActionProposal {
  id: string;
  findingRuleId: string;
  action: string;
  mode: GovernanceMode;
  risk: GovernanceRisk;
  evidence: readonly GovernanceEvidenceRef[];
  impact?: GovernanceImpact;
  execution: ActionExecution;
  preview: ActionPreview;
}

export type ActionReceiptStatus = 'completed' | 'applied' | 'rolled-back' | 'failed';

export type ActionChangeKind =
  | 'execute-command'
  | 'create-file'
  | 'update-file'
  | 'delete-file';

/** A redacted description of one side effect. Raw file backups stay in local provider storage. */
export interface ActionChange {
  kind: ActionChangeKind;
  target: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface ActionRollback {
  available: boolean;
  reason?: string;
  rollbackReceiptId?: string;
}

/** Immutable local record created after an explicitly approved action finishes. */
export interface ActionReceipt {
  version: 1;
  id: string;
  action: string;
  target: ActionExecutionTarget;
  status: ActionReceiptStatus;
  actor: 'local-user';
  approvedAt: string;
  completedAt: string;
  summary: string;
  changes: readonly ActionChange[];
  rollback: ActionRollback;
  result?: Readonly<Record<string, JsonValue>>;
  reversesReceiptId?: string;
}

// ---------------------------------------------------------------------------
// Compaction: a first-class, diffable object (engine lands in a later milestone)
// ---------------------------------------------------------------------------

export type DropSeverity = 'noise' | 'normal' | 'notable' | 'critical';

export type BlockFate =
  | { kind: 'kept'; from: BlockId; to: BlockId }
  | { kind: 'truncated'; from: BlockId; to: BlockId; keptTokens: number; lostTokens: number }
  | {
      kind: 'summarized';
      from: readonly BlockId[];
      into: BlockId;
      /** Token-weighted mean over `from` of: fraction of a block's salient
       * identifiers that reappear in the summary. 0..1. */
      coverage: number;
      /** Shared identifiers that justify the verdict. */
      evidence: readonly string[];
    }
  | { kind: 'dropped'; from: BlockId; lostTokens: number; severity: DropSeverity; why: string }
  | { kind: 'unobserved'; from: BlockId; tokens: number; severity: DropSeverity; why: string }
  | { kind: 'added'; to: BlockId };

export interface CompactionEvent {
  atSeq: number;
  /** Frame seq before / after the compaction. */
  before: number;
  after: number;
  fates: readonly BlockFate[];
  stats: {
    beforeTokens: number;
    afterTokens: number;
    droppedTokens: number;
    unobservedTokens: number;
    summarizedTokens: number;
    compressionRatio: number;
  };
}

export interface AlignOptions {
  /** CDC average chunk size in tokens. Too large loses resolution; too small explodes noise. */
  avgChunkTokens?: number;
  /** Coverage threshold for the `summarized` verdict (normalized by summary length). */
  summaryCoverageThreshold?: number;
}

export interface DiffEngine {
  align(before: ContextFrame, after: ContextFrame, opts?: AlignOptions): readonly BlockFate[];
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/** First bytes of a source, for cheap format detection. Never load whole files. */
export interface SourceProbe {
  /** Up to the first 64 KiB, decoded as UTF-8 (may end mid-character; tolerate). */
  head: string;
  /** File path or stream name, if known. */
  name?: string;
  byteLength?: number;
}

export interface ParseContext {
  sourceId: string;
}

export type AccountingStrategy = 'exact-request' | 'usage-calibrated' | 'heuristic-only';

export interface AdapterCapabilities {
  accounting: AccountingStrategy;
  exactSystemPrompt: boolean;
  exactToolSchemas: boolean;
  exactUsage: boolean;
  compaction: 'none' | 'marker' | 'diff';
}

export interface SchemaPricer {
  price(toolName: string): TokenCount | undefined;
}

export interface TokenEstimator {
  readonly id: string;
  estimate(text: string, model?: ModelIdentity): TokenCount;
}

/**
 * Format drift is caught, not thrown: unknown structures degrade to Anomaly
 * with a redacted sample, ready to be pasted into a GitHub issue.
 */
export interface Anomaly {
  atRecord: number;
  code: 'unknown-record-type' | 'missing-field' | 'schema-version-drift' | 'unparseable';
  detail: string;
  /** Pseudonymized raw slice; safe to share, still reproduces structural bugs. */
  redactedSample: string;
}

/**
 * Tool-availability change observed in the log. Source logs never carry tool
 * SCHEMAS, but they do carry names: the deferred-tool roster (tools available
 * for on-demand loading, costing ~nothing while deferred), schema
 * materialization events, and MCP server announcements. Set arithmetic over
 * these deltas is exact; only the token PRICE of a schema is a prior.
 */
export interface ToolRosterDelta {
  atRecord: number;
  /** Tool names that became available in deferred (schema-not-resident) form. */
  deferredAdded?: readonly string[];
  /** Tool names removed from the deferred roster. */
  deferredRemoved?: readonly string[];
  /** Deferred tools whose schemas were materialized into context (e.g. ToolSearch). */
  loaded?: readonly string[];
  /** MCP server names announced via instruction blocks. */
  mcpServersAdded?: readonly string[];
}

export type ParseEvent =
  | { t: 'frame'; frame: ContextFrame }
  | { t: 'compaction'; event: CompactionEvent }
  | { t: 'roster'; delta: ToolRosterDelta }
  /**
   * Blocks that entered the conversation timeline but were never part of any
   * emitted frame — the log ended before the next model call. No model ever
   * saw them, so they must stay OUT of frames and calibration; session-level
   * accounting (tool call counts, never-called detection) still needs them,
   * or the final turn's activity goes invisible.
   */
  | { t: 'epilogue'; blocks: readonly ContextBlock[] }
  | { t: 'anomaly'; anomaly: Anomaly }
  | { t: 'progress'; bytes: number; total?: number };

export interface Adapter {
  readonly id: 'claude-code' | 'codex' | 'raw-request' | (string & {});
  /** Supported source format version range. Out-of-range degrades with a warning, never errors. */
  readonly schemaRange: string;
  readonly capabilities: AdapterCapabilities;
  /** What the source proves about its Agent/runtime. Unknown is explicit. */
  readonly agentCapabilities: AgentCapabilities;
  readonly tokenEstimator?: TokenEstimator;
  readonly schemaPricer?: SchemaPricer;
  detect(probe: SourceProbe): { match: boolean; score: number; note?: string };
  /** Streaming: emits as it parses, so UIs can render while parsing. Never throws. */
  parse(input: AsyncIterable<Uint8Array>, ctx: ParseContext): AsyncIterable<ParseEvent>;
}
