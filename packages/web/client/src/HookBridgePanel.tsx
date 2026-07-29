import { useEffect, useState } from 'react';
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
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
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
  const [agent, setAgent] = useState<HookBridgeAgent>('codex');
  const [provider, setProvider] = useState<HookBridgeProvider>('tokray-native');
  const [approved, setApproved] = useState(false);
  const [codexApproved, setCodexApproved] = useState(false);
  const statusQuery = useQuery({ queryKey: ['hook-bridges'], queryFn: api.hookBridges });
  const codexStatusQuery = useQuery({
    queryKey: ['codex-hook-status'],
    queryFn: api.codexHookStatus,
    enabled: agent === 'codex' && provider === 'tokray-native',
    retry: false,
  });
  const receiptsQuery = useQuery({ queryKey: ['action-receipts'], queryFn: api.receipts });
  const previewMutation = useMutation({ mutationFn: api.previewHookBridge });
  const codexPreviewMutation = useMutation({ mutationFn: api.previewCodexHookConnection });
  const selfTestMutation = useMutation({
    mutationFn: api.selfTestCodexHook,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['codex-hook-status'] }),
  });
  const applyMutation = useMutation({
    mutationFn: api.applyHookBridge,
    onSuccess: async () => {
      setApproved(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hook-bridges'] }),
        queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['codex-hook-status'] }),
      ]);
    },
  });
  const codexApplyMutation = useMutation({
    mutationFn: api.applyCodexHookConnection,
    onSuccess: async () => {
      setCodexApproved(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['codex-hook-status'] }),
      ]);
      codexPreviewMutation.mutate();
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: api.rollbackReceipt,
    onSuccess: async () => {
      codexPreviewMutation.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hook-bridges'] }),
        queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['codex-hook-status'] }),
      ]);
    },
  });
  const copy = chinese ? {
    title: '自动治理', subtitle: '一次连接，后续工具输出在进入模型前自动过滤', registered: 'Bridge 已注册', noBridge: '未配置', preview: '预览配置', previewing: '正在检查', operation: '文件操作', path: 'Tokray 配置', dispatcher: '桥接命令', activation: '生效边界', activationValue: 'Tokray 侧注册完成后，仍需将命令接入 Agent 的原生 Hook', noAgentWrite: '这里只写 Tokray 配置，不会修改 Agent 配置或拦截当前会话。', unavailable: '当前不可应用', apply: '注册此 Bridge', applying: '正在写入', approve: '我确认只写入上方 Tokray 配置文件，并保存可回滚凭证。', receipts: '最近操作凭证', noReceipts: '尚无治理动作执行记录', rollback: '回滚', rollingBack: '正在回滚', applied: '已应用', completed: '已完成', rolledBack: '已回滚', failed: '失败', already: '该 Agent 与 Provider 组合已注册', boundary: 'CodeBuddy 与 Trae 目前只有通用入口，尚未验证厂商原生 Hook。', provider: '治理方式', native: 'Tokray 内置', nativeTag: '无需外部依赖', nativeDetail: '在工具返回后过滤 ANSI、进度噪声、重复行与低信号区段。', rtk: 'RTK', rtkTag: '可选外部工具', rtkDetail: '在命令执行前，将受支持的 Shell 命令改写为 RTK 命令。', interceptOutput: '拦截工具输出', interceptCommand: '改写 Shell 命令', codexConnect: '连接 Codex PostToolUse', codexDetail: '将当前 Bridge 命令结构化合并到项目级 .codex/hooks.json。', codexPreview: '预览 Codex Hook', codexApply: '写入 Codex 配置', codexApprove: '我批准写入上方 Codex 项目配置；写入后仍需在 Codex CLI 的 /hooks 中复核并信任。', codexTrust: 'Codex 官方状态检测', codexConnected: 'Codex Hook 已写入', bridgeStep: 'Bridge', hookStep: 'Hook 配置', automaticStep: 'Codex 信任', setupBridgeTitle: '自动治理未连接', setupBridgeDetail: '注册 Tokray Native Bridge 后连接 Codex Hook。', connectHookTitle: 'Hook 尚未连接', connectHookDetail: '当前定义会幂等写入项目配置。', trustTitle: '等待 Codex 信任', trustDetail: '当前 Hook 尚未获信任，请在 Codex 的 /hooks 中确认。', activeTitle: '自动治理已生效', activeDetail: 'Codex 已发现并信任当前 Hook 定义。', invalidTitle: '自动治理已失效', invalidDetail: '状态检查未通过，请修复后重新自检。', checkingAutomation: '正在检查自动治理状态', checkingAutomationDetail: '正在读取 Codex 官方 hooks/list。', selfTest: '本地自检', selfTesting: '自检中', selfTestPassed: '本地链路通过', selfTestFailed: '本地链路未通过', noModel: '0 次模型调用', bytes: '字节', reduction: '输出缩减', refreshStatus: '刷新状态',
  } : {
    title: 'Automatic governance', subtitle: 'Connect once, then filter future tool output before it reaches the model', registered: 'Bridge registered', noBridge: 'Not configured', preview: 'Preview config', previewing: 'Checking', operation: 'File operation', path: 'Tokray config', dispatcher: 'Bridge command', activation: 'Activation boundary', activationValue: 'After Tokray-side registration, connect the command to the Agent-native Hook', noAgentWrite: 'This only writes Tokray config. It does not modify Agent config or intercept the current session.', unavailable: 'Not ready to apply', apply: 'Register Bridge', applying: 'Writing', approve: 'I approve writing only the Tokray configuration above and storing a reversible receipt.', receipts: 'Recent action receipts', noReceipts: 'No governance action receipts yet', rollback: 'Rollback', rollingBack: 'Rolling back', applied: 'Applied', completed: 'Completed', rolledBack: 'Rolled back', failed: 'Failed', already: 'This Agent and Provider combination is registered', boundary: 'CodeBuddy and Trae currently expose only a generic entry point; vendor-native Hook support is not verified.', provider: 'Governance method', native: 'Tokray Native', nativeTag: 'No external dependency', nativeDetail: 'Post-process tool output to remove ANSI noise, progress updates, repeated lines, and low-signal regions.', rtk: 'RTK', rtkTag: 'Optional external tool', rtkDetail: 'Rewrite supported Shell commands to RTK commands before execution.', interceptOutput: 'Intercept tool output', interceptCommand: 'Rewrite Shell commands', codexConnect: 'Connect Codex PostToolUse', codexDetail: 'Structurally merge this Bridge command into the project-level .codex/hooks.json.', codexPreview: 'Preview Codex Hook', codexApply: 'Write Codex config', codexApprove: 'I approve writing the Codex project config above; I will still review and trust it in Codex CLI /hooks.', codexTrust: 'Official Codex status', codexConnected: 'Codex Hook is written', bridgeStep: 'Bridge', hookStep: 'Hook config', automaticStep: 'Codex trust', setupBridgeTitle: 'Automatic governance is not connected', setupBridgeDetail: 'Register the Tokray Native Bridge, then connect the Codex Hook.', connectHookTitle: 'Hook is not connected', connectHookDetail: 'The current definition will be written idempotently.', trustTitle: 'Waiting for Codex trust', trustDetail: 'Review the current Hook in Codex /hooks.', activeTitle: 'Automatic governance is active', activeDetail: 'Codex discovered and trusts the current Hook definition.', invalidTitle: 'Automatic governance is invalid', invalidDetail: 'The status check failed; repair the connection and rerun the test.', checkingAutomation: 'Checking automatic governance', checkingAutomationDetail: 'Reading Codex hooks/list.', selfTest: 'Local self-test', selfTesting: 'Testing', selfTestPassed: 'Local path passed', selfTestFailed: 'Local path failed', noModel: '0 model calls', bytes: 'bytes', reduction: 'output reduction', refreshStatus: 'Refresh status',
  };
  const preview = previewMutation.data;
  const codexPreview = codexPreviewMutation.data;
  const registeredBridge = statusQuery.data?.bridges.find((bridge) => bridge.agent === agent && bridge.provider === provider && bridge.enabled);
  const codexConfigWritten = codexPreview?.status === 'ready' && codexPreview.operation === 'unchanged';
  const runtime = codexStatusQuery.data;
  const selfTest = selfTestMutation.data;
  const receipts = (receiptsQuery.data ?? []).slice(0, 8);
  const statusLabels = { applied: copy.applied, completed: copy.completed, 'rolled-back': copy.rolledBack, failed: copy.failed };
  const selectAgent = (next: HookBridgeAgent) => {
    setAgent(next);
    setApproved(false);
    setCodexApproved(false);
    previewMutation.reset();
    applyMutation.reset();
    codexPreviewMutation.reset();
    codexApplyMutation.reset();
    selfTestMutation.reset();
  };
  const selectProvider = (next: HookBridgeProvider) => {
    setProvider(next);
    setApproved(false);
    setCodexApproved(false);
    previewMutation.reset();
    applyMutation.reset();
    codexPreviewMutation.reset();
    codexApplyMutation.reset();
    selfTestMutation.reset();
  };
  const applyPreview = (value: HookBridgePreview) => {
    if (!approved || value.status !== 'ready') return;
    applyMutation.mutate(value);
  };

  useEffect(() => {
    if (agent === 'codex' && provider === 'tokray-native' && registeredBridge) codexPreviewMutation.mutate();
  }, [agent, provider, registeredBridge?.id]);

  const automationTitle = statusQuery.isLoading || codexStatusQuery.isLoading || (registeredBridge && codexPreviewMutation.isPending)
    ? copy.checkingAutomation
    : !registeredBridge
      ? copy.setupBridgeTitle
      : runtime?.state === 'active'
        ? copy.activeTitle
        : runtime?.state === 'pending-trust'
          ? copy.trustTitle
          : runtime?.state === 'invalid'
            ? copy.invalidTitle
            : copy.connectHookTitle;
  const automationDetail = statusQuery.isLoading || codexStatusQuery.isLoading || (registeredBridge && codexPreviewMutation.isPending)
    ? copy.checkingAutomationDetail
    : !registeredBridge
      ? copy.setupBridgeDetail
      : runtime?.state === 'active'
        ? copy.activeDetail
        : runtime?.issue ?? (runtime?.state === 'pending-trust' ? copy.trustDetail : runtime?.state === 'invalid' ? copy.invalidDetail : copy.connectHookDetail);

  return <section className="hook-bridge" aria-labelledby="hook-bridge-title">
    <header className="hook-bridge-heading">
      <div><span className="hook-bridge-icon"><PlugZap size={16} /></span><div><h3 id="hook-bridge-title">{copy.title}</h3><p>{copy.subtitle}</p></div></div>
      <span className={registeredBridge ? 'hook-state registered' : 'hook-state'}>{registeredBridge ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}{registeredBridge ? copy.registered : copy.noBridge}</span>
    </header>
    {agent === 'codex' && provider === 'tokray-native' && <div className={`hook-automation-state hook-runtime-${runtime?.state ?? 'checking'}`}>
      <div className="hook-runtime-summary">{runtime?.state === 'active' ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}<span><strong>{automationTitle}</strong><p>{automationDetail}</p></span><button type="button" className="icon-button" title={copy.refreshStatus} aria-label={copy.refreshStatus} disabled={codexStatusQuery.isFetching} onClick={() => codexStatusQuery.refetch()}><ScanSearch size={15} /></button></div>
      <ol aria-label={copy.title}>
        <li className={registeredBridge ? 'complete' : 'current'}>{registeredBridge ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}<span>{copy.bridgeStep}</span></li>
        <li className={runtime?.configured ? 'complete' : registeredBridge ? 'current' : ''}>{runtime?.configured ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}<span>{copy.hookStep}</span></li>
        <li className={runtime?.state === 'active' ? 'complete' : runtime?.configured ? 'current' : ''}>{runtime?.state === 'active' ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}<span>{copy.automaticStep}</span></li>
      </ol>
      <div className="hook-self-test-row"><button type="button" className="secondary-command" disabled={selfTestMutation.isPending || !runtime?.configured} onClick={() => selfTestMutation.mutate()}>{selfTestMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <ScanSearch size={14} />}{selfTestMutation.isPending ? copy.selfTesting : copy.selfTest}</button>{selfTest && <span className={selfTest.status === 'passed' ? 'self-test-passed' : 'self-test-failed'}>{selfTest.status === 'passed' ? <CheckCircle2 size={13} /> : <CircleOff size={13} />}<strong>{selfTest.status === 'passed' ? copy.selfTestPassed : copy.selfTestFailed}</strong><small>{copy.noModel} · {selfTest.inputBytes} → {selfTest.outputBytes} {copy.bytes} · {selfTest.reductionPercentage}% {copy.reduction}</small></span>}</div>
    </div>}
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
    {agent === 'codex' && provider === 'tokray-native' && registeredBridge && <div className="codex-hook-connection">
      <header><div><strong>{copy.codexConnect}</strong><p>{copy.codexDetail}</p></div><button type="button" className="secondary-command" disabled={codexPreviewMutation.isPending} onClick={() => codexPreviewMutation.mutate()}>{codexPreviewMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Eye size={14} />}{codexPreviewMutation.isPending ? copy.previewing : copy.codexPreview}</button></header>
      {codexPreview && <div className={`hook-preview hook-preview-${codexPreview.status}`}>
        <dl><div><dt>{copy.operation}</dt><dd>{codexPreview.operation}</dd></div><div><dt>{copy.path}</dt><dd><code>{codexPreview.path}</code></dd></div><div><dt>{copy.dispatcher}</dt><dd><code>{codexPreview.dispatcherCommand}</code></dd></div><div><dt>{copy.activation}</dt><dd>{copy.codexTrust}</dd></div></dl>
        {codexPreview.status === 'ready' && codexPreview.operation !== 'unchanged' ? <div className="hook-approval">
          <label><input type="checkbox" checked={codexApproved} onChange={(event) => setCodexApproved(event.target.checked)} /><span>{copy.codexApprove}</span></label>
          <button type="button" className="primary-command" disabled={!codexApproved || codexApplyMutation.isPending} onClick={() => codexApplyMutation.mutate(codexPreview)}><PlugZap size={14} />{codexApplyMutation.isPending ? copy.applying : copy.codexApply}</button>
        </div> : <p><CircleOff size={13} />{codexPreview.operation === 'unchanged' ? copy.codexConnected : `${copy.unavailable}: ${codexPreview.issue ?? codexPreview.status}`}</p>}
      </div>}
    </div>}
    {(previewMutation.error || applyMutation.error || codexPreviewMutation.error || codexApplyMutation.error || codexStatusQuery.error || selfTestMutation.error || rollbackMutation.error) && <div className="hook-error"><CircleOff size={13} />{(previewMutation.error ?? applyMutation.error ?? codexPreviewMutation.error ?? codexApplyMutation.error ?? codexStatusQuery.error ?? selfTestMutation.error ?? rollbackMutation.error)?.message}</div>}
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
