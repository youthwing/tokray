import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Eye,
  FileClock,
  LockKeyhole,
  PlugZap,
  Route,
  ShieldCheck,
} from 'lucide-react';
import type { ActionProposal, AnalysisReport, SessionFinding } from '@tokray/node';
import { fmtTokens } from './format';
import { useI18n } from './i18n';
import { RtkPanel } from './RtkPanel';
import { HookBridgePanel } from './HookBridgePanel';
import { NativeEnginePanel } from './NativeEnginePanel';

type ProposalFilter = 'all' | 'change' | 'manual' | 'inspect';

interface ActionCopy {
  title: string;
  detail: string;
  steps: readonly string[];
}

function actionCopy(action: string, chinese: boolean): ActionCopy {
  const copies: Record<string, readonly [ActionCopy, ActionCopy]> = {
    'inspect-context-peak': [
      { title: '拆分或压缩高峰上下文', detail: '通过 Agent 原生会话控制减少后续调用携带的历史内容。', steps: ['核对峰值调用中的主要占用', '选择拆分会话或触发原生压缩', '比较后续调用的非缓存输入'] },
      { title: 'Split or compact peak context', detail: 'Use native Agent session controls to reduce history carried into later calls.', steps: ['Inspect the largest contributors in the peak call', 'Choose a new session or native compaction', 'Compare uncached input on later calls'] },
    ],
    'review-persistent-block': [
      { title: '外化长期驻留内容', detail: '将长期携带的大块内容改为引用、文件或按需检索。', steps: ['确认该内容后续是否仍被引用', '在请求组装层替换为按需引用', '验证任务质量与输入 Token'] },
      { title: 'Externalize persistent context', detail: 'Replace long-lived payloads with references, files, or retrieval on demand.', steps: ['Confirm whether later calls still reference the block', 'Replace it at request assembly with an on-demand reference', 'Verify task quality and input Tokens'] },
    ],
    'compress-tool-output': [
      { title: '压缩工具返回', detail: '在工具结果进入模型前通过 RTK、Hook 或包装器裁剪噪声。', steps: ['预览原始输出与压缩候选', '在工具 Hook 中启用批准后的转换', '导入后续 Usage 验证真实节省'] },
      { title: 'Compress tool output', detail: 'Trim noise with RTK, a Hook, or a wrapper before the result reaches the model.', steps: ['Preview original and compressed output', 'Enable the approved transform in a tool Hook', 'Import later Usage to verify actual savings'] },
    ],
    'deduplicate-context-content': [
      { title: '去重上下文内容', detail: '在请求组装边界只保留一份相同内容，并保留原始引用。', steps: ['核对全部重复块的 SourceRef', '在请求代理中生成去重候选', '确认引用完整后验证下一次调用'] },
      { title: 'Deduplicate context content', detail: 'Keep one copy at request assembly while preserving source references.', steps: ['Inspect every duplicate SourceRef', 'Generate a deduplicated request candidate', 'Confirm reference coverage and verify the next call'] },
    ],
    'defer-unused-tools': [
      { title: '延迟加载闲置工具', detail: '通过 Agent 工具白名单或 MCP 配置移除未使用 Schema 的常驻成本。', steps: ['确认会话中从未调用的工具集合', '预览 Agent/MCP 配置差异', '批准后在新会话验证工具可用性'] },
      { title: 'Defer unused tools', detail: 'Use Agent allowlists or MCP configuration to remove unused resident schemas.', steps: ['Confirm tools never called in the session', 'Preview the Agent/MCP configuration diff', 'Verify tool availability in a new session after approval'] },
    ],
    'review-compaction': [
      { title: '检查压缩结果', detail: '确认关键约束是否保留，再决定是否调整原生压缩策略。', steps: ['检查保留、摘要和不可观测内容', '标记必须保护的关键约束', '在下一次压缩后比较内容命运'] },
      { title: 'Review compaction result', detail: 'Confirm critical constraints survived before changing native compaction behavior.', steps: ['Inspect kept, summarized, and unobserved content', 'Mark constraints that must be protected', 'Compare block fates after the next compaction'] },
    ],
    'stabilize-cache-prefix': [
      { title: '稳定缓存前缀', detail: '固定系统指令、工具顺序和公共前缀，将动态内容移到后部。', steps: ['定位导致非缓存输入增加的边界', '在请求组装层固定静态前缀', '比较后续缓存命中率与非缓存输入'] },
      { title: 'Stabilize cache prefix', detail: 'Keep instructions, tool order, and shared prefixes stable; append dynamic content later.', steps: ['Locate boundaries that increase uncached input', 'Stabilize the static request prefix', 'Compare later cache hit rate and uncached input'] },
    ],
    'preserve-cache-prefix': [
      { title: '保持当前缓存前缀', detail: '当前缓存复用表现良好，只需持续观测，不生成修改动作。', steps: ['保留当前静态前缀结构', '监控模型或工具切换边界', '缓存下降时重新诊断'] },
      { title: 'Preserve the cache prefix', detail: 'Cache reuse is healthy; keep observing without producing a change.', steps: ['Keep the current static prefix structure', 'Monitor model and tool-switch boundaries', 'Diagnose again if reuse declines'] },
    ],
    'inspect-calibration': [
      { title: '检查计量校准', detail: '先处理证据质量问题，避免基于低可信估算执行治理。', steps: ['打开低可信校准区间', '核对 Usage 与可见内容缺口', '可信度恢复后再评估优化收益'] },
      { title: 'Inspect accounting calibration', detail: 'Resolve evidence quality before acting on low-confidence estimates.', steps: ['Open the low-confidence calibration epoch', 'Compare Usage with visible context gaps', 'Reassess savings after confidence recovers'] },
    ],
    'review-adapter-anomalies': [
      { title: '检查解析异常', detail: '未知日志结构可能影响诊断完整性，应先核对适配器证据。', steps: ['打开脱敏异常记录', '确认日志格式与适配器版本', '重新解析后检查治理结论'] },
      { title: 'Review parser anomalies', detail: 'Unknown log structures may reduce diagnostic coverage; inspect adapter evidence first.', steps: ['Open redacted anomaly records', 'Confirm log format and adapter version', 'Reparse and review governance findings'] },
    ],
  };
  const pair = copies[action];
  if (pair) return pair[chinese ? 0 : 1];
  return chinese
    ? { title: action, detail: '检查证据后确定执行方式。', steps: ['检查证据', '生成变更预览', '验证后续调用'] }
    : { title: action, detail: 'Inspect evidence before choosing an execution path.', steps: ['Inspect evidence', 'Prepare a change preview', 'Verify later calls'] };
}

function impactValue(proposal: ActionProposal): number | undefined {
  return proposal.impact?.estimatedSavingTokens?.value
    ?? proposal.impact?.estimatedWasteTokens?.value;
}

export function GovernanceCenter({
  report,
  onNavigate,
}: {
  report: AnalysisReport;
  onNavigate: (finding: SessionFinding) => void;
}) {
  const { locale } = useI18n();
  const chinese = locale === 'zh-CN';
  const [filter, setFilter] = useState<ProposalFilter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const copy = chinese ? {
    eyebrow: 'M2 · GOVERN', title: '治理行动队列', description: '把诊断结果转换成有证据、执行位置和能力门槛的操作提案。默认只读，受支持动作可在批准后执行。',
    readOnly: '默认只读保护', readOnlyDetail: '不会自动写入 Agent 配置或修改当前上下文。只有明确批准后，才会执行白名单实验或写入 Tokray 自管配置。',
    findings: '治理发现', future: '影响未来调用', estimated: '预计可治理', bridges: '需要 Bridge',
    all: '全部', change: '变更建议', manual: '手动执行', inspect: '仅检查', action: '建议动作', impact: 'Token 影响', target: '执行位置', status: '应用状态',
    noImpact: '待验证', evidence: '条证据', preview: '操作预览', safety: '安全边界', noWrites: '本次预览不写文件、不修改运行时', appliesFuture: '批准后的动作仅影响未来模型调用',
    capability: '能力门槛', noCapability: '由 Tokray 或外部执行器提供，不依赖 Agent 原生能力', plan: '执行计划', viewEvidence: '查看证据', unavailable: '暂不可应用',
    exact: '精确', inferred: '推断', guessed: '估算', method: '计量方法', risk: '风险', low: '低', medium: '中', high: '高',
  } : {
    eyebrow: 'M2 · GOVERN', title: 'Governance action queue', description: 'Turn findings into evidence-linked proposals with an execution location and capability gate. Read-only by default; supported actions can run after approval.',
    readOnly: 'Read-only by default', readOnlyDetail: 'Tokray never changes Agent config or live context automatically. Only explicit approval can run an allowlisted experiment or write Tokray-managed config.',
    findings: 'Governance findings', future: 'Affect future calls', estimated: 'Estimated governable', bridges: 'Need a Bridge',
    all: 'All', change: 'Change proposals', manual: 'Manual', inspect: 'Inspect only', action: 'Proposed action', impact: 'Token impact', target: 'Execution location', status: 'Apply status',
    noImpact: 'To be verified', evidence: 'evidence refs', preview: 'Action preview', safety: 'Safety boundary', noWrites: 'This preview writes no files and changes no runtime state', appliesFuture: 'An approved action would affect future model calls only',
    capability: 'Capability gate', noCapability: 'Provided by Tokray or an external executor; no native Agent capability is assumed', plan: 'Execution plan', viewEvidence: 'View evidence', unavailable: 'Apply unavailable',
    exact: 'Exact', inferred: 'Inferred', guessed: 'Estimated', method: 'Method', risk: 'Risk', low: 'Low', medium: 'Medium', high: 'High',
  };
  const targetCopy = chinese ? {
    tokray: ['Tokray 本地分析', '在当前只读报告中执行'],
    'agent-config': ['Agent / MCP 配置', '工具白名单与加载配置'],
    'agent-control': ['Agent 原生控制', '会话拆分或上下文压缩'],
    'tool-hook': ['工具返回 Hook', '结果进入模型之前'],
    'request-proxy': ['请求组装代理', 'Context 发送给模型之前'],
  } : {
    tokray: ['Tokray local analysis', 'Inside the current read-only report'],
    'agent-config': ['Agent / MCP config', 'Tool allowlist and loading configuration'],
    'agent-control': ['Native Agent control', 'Session split or context compaction'],
    'tool-hook': ['Tool-result Hook', 'Before the result enters the model'],
    'request-proxy': ['Request assembly proxy', 'Before Context is sent to the model'],
  };
  const availabilityCopy = chinese ? {
    'inspect-only': '仅检查', 'manual-only': '手动执行', 'bridge-required': '需要 Bridge', 'apply-ready': '可以应用',
  } : {
    'inspect-only': 'Inspect only', 'manual-only': 'Manual change', 'bridge-required': 'Bridge required', 'apply-ready': 'Ready to apply',
  };
  const filtered = useMemo(() => report.actionProposals.filter((proposal) => {
    if (filter === 'change') return proposal.execution.availability === 'bridge-required' || proposal.execution.availability === 'apply-ready';
    if (filter === 'manual') return proposal.execution.availability === 'manual-only';
    if (filter === 'inspect') return proposal.execution.availability === 'inspect-only';
    return true;
  }), [filter, report.actionProposals]);
  const selected = filtered.find((proposal) => proposal.id === selectedId) ?? filtered[0];
  const finding = selected ? report.diagnosis.findings.find((item) => item.ruleId === selected.findingRuleId) : undefined;
  const estimatedSaving = report.actionProposals.reduce((sum, proposal) => sum + (proposal.impact?.estimatedSavingTokens?.value ?? 0), 0);
  const futureCount = report.actionProposals.filter((proposal) => proposal.execution.appliesTo === 'future-calls').length;
  const bridgeCount = report.actionProposals.filter((proposal) => proposal.execution.availability === 'bridge-required').length;
  const filters: Array<[ProposalFilter, string, number]> = [
    ['all', copy.all, report.actionProposals.length],
    ['change', copy.change, report.actionProposals.filter((item) => item.execution.availability === 'bridge-required' || item.execution.availability === 'apply-ready').length],
    ['manual', copy.manual, report.actionProposals.filter((item) => item.execution.availability === 'manual-only').length],
    ['inspect', copy.inspect, report.actionProposals.filter((item) => item.execution.availability === 'inspect-only').length],
  ];

  return <div className="governance-center">
    <section className="governance-intro">
      <div><span>{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.description}</p></div>
      <div className="readonly-state"><LockKeyhole size={17} /><div><strong>{copy.readOnly}</strong><p>{copy.readOnlyDetail}</p></div></div>
    </section>

    <section className="governance-metrics" aria-label={copy.title}>
      <div><ShieldCheck size={16} /><span>{copy.findings}</span><strong>{report.actionProposals.length}</strong><small>{report.diagnosis.issueCount} warning+</small></div>
      <div><FileClock size={16} /><span>{copy.future}</span><strong>{futureCount}</strong><small>future-calls</small></div>
      <div><CircleGauge size={16} /><span>{copy.estimated}</span><strong>{estimatedSaving > 0 ? fmtTokens(estimatedSaving) : '—'}</strong><small>estimated saving</small></div>
      <div><PlugZap size={16} /><span>{copy.bridges}</span><strong>{bridgeCount}</strong><small>action provider</small></div>
    </section>

    <NativeEnginePanel report={report} onNavigate={onNavigate} />

    <RtkPanel />

    <HookBridgePanel />

    <div className="governance-filter" role="group" aria-label={copy.status}>
      {filters.map(([id, label, count]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}><span>{label}</span><strong>{count}</strong></button>)}
    </div>

    <section className="governance-table" aria-label={copy.title}>
      <div className="governance-table-head"><span>{copy.action}</span><span>{copy.impact}</span><span>{copy.target}</span><span>{copy.status}</span><span /></div>
      {filtered.map((proposal) => {
        const text = actionCopy(proposal.action, chinese);
        const target = targetCopy[proposal.execution.target];
        const impact = impactValue(proposal);
        return <button type="button" className={selected?.id === proposal.id ? 'governance-row selected' : 'governance-row'} key={proposal.id} onClick={() => setSelectedId(proposal.id)}>
          <span className="governance-action-copy"><strong>{text.title}</strong><code>{proposal.findingRuleId}</code></span>
          <span className="governance-impact"><strong>{impact !== undefined ? fmtTokens(impact) : '—'}</strong><small>{proposal.impact?.estimatedSavingTokens ? 'saving' : proposal.impact?.estimatedWasteTokens ? 'waste' : copy.noImpact}</small></span>
          <span className="governance-target"><strong>{target[0]}</strong><small>{target[1]}</small></span>
          <span className={`action-status status-${proposal.execution.availability}`}>{availabilityCopy[proposal.execution.availability]}</span>
          <ChevronRight size={15} />
        </button>;
      })}
    </section>

    {selected && <section className="action-preview" aria-live="polite">
      <div className="action-preview-heading"><div><span>{copy.preview}</span><h3>{actionCopy(selected.action, chinese).title}</h3><p>{actionCopy(selected.action, chinese).detail}</p></div><span className={`action-status status-${selected.execution.availability}`}>{availabilityCopy[selected.execution.availability]}</span></div>
      <div className="preview-route" aria-label={copy.plan}>
        <div><Eye size={16} /><span>Evidence</span><strong>{selected.evidence.length} {copy.evidence}</strong></div><ArrowRight size={15} />
        <div><Route size={16} /><span>{copy.target}</span><strong>{targetCopy[selected.execution.target][0]}</strong></div><ArrowRight size={15} />
        <div><ShieldCheck size={16} /><span>{copy.status}</span><strong>{availabilityCopy[selected.execution.availability]}</strong></div>
      </div>
      <div className="preview-detail-grid">
        <div><span>{copy.safety}</span><p><LockKeyhole size={14} />{copy.noWrites}</p><p><FileClock size={14} />{copy.appliesFuture}</p></div>
        <div><span>{copy.capability}</span><p>{selected.execution.requiredCapability ? <><code>{selected.execution.requiredCapability}</code><strong className={`capability-${selected.execution.capabilitySupport}`}>{selected.execution.capabilitySupport}</strong></> : copy.noCapability}</p></div>
        <div><span>{copy.impact}</span><p>{selected.impact?.estimatedSavingTokens ? <><strong>{fmtTokens(selected.impact.estimatedSavingTokens.value)}</strong><small>{copy.method}: {selected.impact.estimatedSavingTokens.method}</small></> : copy.noImpact}</p><p><small>{copy.risk}: {copy[selected.risk]}</small></p></div>
      </div>
      <div className="preview-plan"><span>{copy.plan}</span><ol>{actionCopy(selected.action, chinese).steps.map((step) => <li key={step}><CheckCircle2 size={15} /><span>{step}</span></li>)}</ol></div>
      <div className="preview-actions">
        <button type="button" className="secondary-command" disabled={!finding} onClick={() => finding && onNavigate(finding)}><Eye size={15} />{copy.viewEvidence}</button>
        <button type="button" className="primary-command" disabled><PlugZap size={15} />{copy.unavailable}</button>
      </div>
    </section>}
  </div>;
}
