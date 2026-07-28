import type {
  AgentSourceStatus,
  ActionReceipt,
  AnalysisReport,
  ConversationEntry,
  HookBridgeAgent,
  HookBridgeApplyResult,
  HookBridgePreview,
  HookBridgeProvider,
  HookBridgeStatus,
  LocalSession,
  NativeFilterProfile,
  NativeFilterResult,
  NativeGovernanceStrategy,
  RtkComparisonExecution,
  RtkIntegrationStatus,
  RtkRewritePreview,
  TokrayConfigIssue,
} from '@tokray/node';

export interface WebConfigStatus {
  files: string[];
  sourceCount: number;
  adapters: string[];
  issues: TokrayConfigIssue[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export const api = {
  sessions: () => request<LocalSession[]>('/api/sessions'),
  agentSources: () => request<AgentSourceStatus[]>('/api/agent-sources'),
  config: () => request<WebConfigStatus>('/api/config'),
  analysis: (sessionId: string) => request<AnalysisReport>(`/api/analyses/${encodeURIComponent(sessionId)}`),
  conversation: (sessionId: string, seq: number) => request<ConversationEntry[]>(`/api/analyses/${encodeURIComponent(sessionId)}/frames/${seq}/conversation`),
  sessionConversation: (sessionId: string) => request<ConversationEntry[]>(`/api/analyses/${encodeURIComponent(sessionId)}/conversation`),
  rtkStatus: () => request<RtkIntegrationStatus>('/api/integrations/rtk'),
  nativeStrategies: () => request<NativeGovernanceStrategy[]>('/api/governance/native-strategies'),
  previewNativeFilter: (input: { output: string; profile: NativeFilterProfile; command?: string; exitCode?: number }) => request<NativeFilterResult>('/api/integrations/native-filter/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }),
  importRtkGain: () => request<RtkIntegrationStatus>('/api/integrations/rtk/gain', { method: 'POST' }),
  previewRtkRewrite: (command: string) => request<RtkRewritePreview>('/api/integrations/rtk/rewrite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  }),
  compareRtkOutput: (command: string, expectedRewrite: string) => request<RtkComparisonExecution>('/api/integrations/rtk/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command, expectedRewrite, approved: true }),
  }),
  hookBridges: () => request<HookBridgeStatus>('/api/integrations/hooks'),
  previewHookBridge: (input: { agent: HookBridgeAgent; provider: HookBridgeProvider }) => request<HookBridgePreview>('/api/integrations/hooks/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }),
  applyHookBridge: (preview: HookBridgePreview) => request<HookBridgeApplyResult>('/api/integrations/hooks/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: preview.agent,
      provider: preview.bridge.provider,
      expectedAfterHash: preview.afterHash,
      registeredAt: preview.bridge.registeredAt,
      approved: true,
    }),
  }),
  receipts: () => request<ActionReceipt[]>('/api/governance/receipts'),
  rollbackReceipt: (receiptId: string) => request<ActionReceipt>(`/api/governance/receipts/${encodeURIComponent(receiptId)}/rollback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approved: true }),
  }),
  clearCache: () => request<{ ok: boolean }>('/api/cache/clear', { method: 'POST' }),
};
