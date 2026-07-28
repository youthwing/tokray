import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleOff,
  Eye,
  FileClock,
  Filter,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  ShieldAlert,
  TerminalSquare,
} from 'lucide-react';
import type { HookBridgeAgent, HookBridgePreview, HookBridgeProvider } from '@tokray/node';
import { api } from './api';
import { useI18n } from './i18n';

const AGENTS: readonly HookBridgeAgent[] = ['claude-code', 'codex', 'codebuddy', 'trae'];
const AGENT_LABELS: Readonly<Record<HookBridgeAgent, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  codebuddy: 'CodeBuddy',
  trae: 'Trae',
};

export function HookBridgePanel() {
  const { locale } = useI18n();
  const chinese = locale === 'zh-CN';
  const queryClient = useQueryClient();
  const [agent, setAgent] = useState<HookBridgeAgent>('claude-code');
  const [provider, setProvider] = useState<HookBridgeProvider>('tokray-native');
  const [approved, setApproved] = useState(false);
  const statusQuery = useQuery({ queryKey: ['hook-bridges'], queryFn: api.hookBridges });
  const receiptsQuery = useQuery({ queryKey: ['action-receipts'], queryFn: api.receipts });
  const previewMutation = useMutation({ mutationFn: api.previewHookBridge });
  const applyMutation = useMutation({
    mutationFn: api.applyHookBridge,
    onSuccess: async () => {
      setApproved(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hook-bridges'] }),
        queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
      ]);
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: api.rollbackReceipt,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hook-bridges'] }),
        queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
      ]);
    },
  });
  const copy = chinese ? {
    title: 'Hook Bridge', subtitle: '为未来 Agent 调用注册可审计的本地治理入口', registered: '此组合已注册', noBridge: '此组合未注册', preview: '预览配置', previewing: '正在检查', operation: '文件操作', path: 'Tokray 配置', dispatcher: '桥接命令', activation: '生效边界', activationValue: 'Tokray 侧注册完成后，仍需将命令接入 Agent 的原生 Hook', noAgentWrite: '这里只写 Tokray 配置，不会修改 Agent 配置或拦截当前会话。', unavailable: '当前不可应用', apply: '注册此 Bridge', applying: '正在写入', approve: '我确认只写入上方 Tokray 配置文件，并保存可回滚凭证。', receipts: '最近操作凭证', noReceipts: '尚无治理动作执行记录', rollback: '回滚', rollingBack: '正在回滚', applied: '已应用', completed: '已完成', rolledBack: '已回滚', failed: '失败', already: '该 Agent 与 Provider 组合已注册', boundary: 'CodeBuddy 与 Trae 目前只有通用入口，尚未验证厂商原生 Hook。', provider: '治理方式', native: 'Tokray 内置', nativeTag: '无需外部依赖', nativeDetail: '在工具返回后过滤 ANSI、进度噪声、重复行与低信号区段。', rtk: 'RTK', rtkTag: '可选外部工具', rtkDetail: '在命令执行前，将受支持的 Shell 命令改写为 RTK 命令。', interceptOutput: '拦截工具输出', interceptCommand: '改写 Shell 命令',
  } : {
    title: 'Hook Bridge', subtitle: 'Register an auditable local governance entry point for future Agent calls', registered: 'Combination registered', noBridge: 'Combination not registered', preview: 'Preview config', previewing: 'Checking', operation: 'File operation', path: 'Tokray config', dispatcher: 'Bridge command', activation: 'Activation boundary', activationValue: 'After Tokray-side registration, connect the command to the Agent-native Hook', noAgentWrite: 'This only writes Tokray config. It does not modify Agent config or intercept the current session.', unavailable: 'Not ready to apply', apply: 'Register Bridge', applying: 'Writing', approve: 'I approve writing only the Tokray configuration above and storing a reversible receipt.', receipts: 'Recent action receipts', noReceipts: 'No governance action receipts yet', rollback: 'Rollback', rollingBack: 'Rolling back', applied: 'Applied', completed: 'Completed', rolledBack: 'Rolled back', failed: 'Failed', already: 'This Agent and Provider combination is registered', boundary: 'CodeBuddy and Trae currently expose only a generic entry point; vendor-native Hook support is not verified.', provider: 'Governance method', native: 'Tokray Native', nativeTag: 'No external dependency', nativeDetail: 'Post-process tool output to remove ANSI noise, progress updates, repeated lines, and low-signal regions.', rtk: 'RTK', rtkTag: 'Optional external tool', rtkDetail: 'Rewrite supported Shell commands to RTK commands before execution.', interceptOutput: 'Intercept tool output', interceptCommand: 'Rewrite Shell commands',
  };
  const preview = previewMutation.data;
  const registeredBridge = statusQuery.data?.bridges.find((bridge) => bridge.agent === agent && bridge.provider === provider && bridge.enabled);
  const receipts = (receiptsQuery.data ?? []).slice(0, 8);
  const statusLabels = { applied: copy.applied, completed: copy.completed, 'rolled-back': copy.rolledBack, failed: copy.failed };
  const selectAgent = (next: HookBridgeAgent) => {
    setAgent(next);
    setApproved(false);
    previewMutation.reset();
    applyMutation.reset();
  };
  const selectProvider = (next: HookBridgeProvider) => {
    setProvider(next);
    setApproved(false);
    previewMutation.reset();
    applyMutation.reset();
  };
  const applyPreview = (value: HookBridgePreview) => {
    if (!approved || value.status !== 'ready') return;
    applyMutation.mutate(value);
  };

  return <section className="hook-bridge" aria-labelledby="hook-bridge-title">
    <header className="hook-bridge-heading">
      <div><span className="hook-bridge-icon"><PlugZap size={16} /></span><div><h3 id="hook-bridge-title">{copy.title}</h3><p>{copy.subtitle}</p></div></div>
      <span className={registeredBridge ? 'hook-state registered' : 'hook-state'}>{registeredBridge ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}{registeredBridge ? copy.registered : copy.noBridge}</span>
    </header>
    <div className="hook-agent-tabs" role="group" aria-label="Agent">
      {AGENTS.map((item) => <button type="button" key={item} className={agent === item ? 'active' : ''} onClick={() => selectAgent(item)}>{AGENT_LABELS[item]}</button>)}
    </div>
    <div className="hook-provider-section">
      <span>{copy.provider}</span>
      <div className="hook-provider-tabs" role="radiogroup" aria-label={copy.provider}>
        <button type="button" role="radio" aria-checked={provider === 'tokray-native'} className={provider === 'tokray-native' ? 'active' : ''} onClick={() => selectProvider('tokray-native')}>
          <Filter size={15} /><span><strong>{copy.native}<small>{copy.nativeTag}</small></strong><em>{copy.nativeDetail}</em></span><code>{copy.interceptOutput}</code>
        </button>
        <button type="button" role="radio" aria-checked={provider === 'rtk'} className={provider === 'rtk' ? 'active' : ''} onClick={() => selectProvider('rtk')}>
          <TerminalSquare size={15} /><span><strong>{copy.rtk}<small>{copy.rtkTag}</small></strong><em>{copy.rtkDetail}</em></span><code>{copy.interceptCommand}</code>
        </button>
      </div>
    </div>
    <div className="hook-bridge-workspace">
      <div className="hook-bridge-boundary"><ShieldAlert size={15} /><div><strong>{copy.activationValue}</strong><p>{copy.noAgentWrite}</p><small>{copy.boundary}</small></div></div>
      <button type="button" className="secondary-command" disabled={previewMutation.isPending} onClick={() => previewMutation.mutate({ agent, provider })}>{previewMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Eye size={14} />}{previewMutation.isPending ? copy.previewing : copy.preview}</button>
    </div>
    {preview && <div className={`hook-preview hook-preview-${preview.status}`}>
      <dl><div><dt>{copy.operation}</dt><dd>{preview.operation}</dd></div><div><dt>{copy.path}</dt><dd><code>{preview.path}</code></dd></div><div><dt>{copy.dispatcher}</dt><dd><code>{preview.bridge.dispatcherCommand}</code></dd></div><div><dt>{copy.activation}</dt><dd>{copy.activationValue}</dd></div></dl>
      {preview.status === 'ready' && preview.operation !== 'unchanged' ? <div className="hook-approval">
        <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>{copy.approve}</span></label>
        <button type="button" className="primary-command" disabled={!approved || applyMutation.isPending} onClick={() => applyPreview(preview)}><PlugZap size={14} />{applyMutation.isPending ? copy.applying : copy.apply}</button>
      </div> : <p><CircleOff size={13} />{preview.operation === 'unchanged' ? copy.already : `${copy.unavailable}: ${preview.issue ?? preview.status}`}</p>}
    </div>}
    {(previewMutation.error || applyMutation.error || rollbackMutation.error) && <div className="hook-error"><CircleOff size={13} />{(previewMutation.error ?? applyMutation.error ?? rollbackMutation.error)?.message}</div>}
    <div className="receipt-ledger">
      <header><FileClock size={15} /><strong>{copy.receipts}</strong><span>{receipts.length}</span></header>
      {receipts.length === 0 ? <p>{copy.noReceipts}</p> : <div>{receipts.map((receipt) => <article key={receipt.id}>
        <span className={`receipt-state receipt-${receipt.status}`}>{statusLabels[receipt.status]}</span>
        <div><strong>{receipt.summary}</strong><code>#{receipt.id.slice(0, 8)} · {new Date(receipt.completedAt).toLocaleString(locale)}</code></div>
        {receipt.rollback.available && <button type="button" className="secondary-command" disabled={rollbackMutation.isPending} onClick={() => rollbackMutation.mutate(receipt.id)}><RotateCcw size={13} />{rollbackMutation.isPending ? copy.rollingBack : copy.rollback}</button>}
      </article>)}</div>}
    </div>
  </section>;
}
