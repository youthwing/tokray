import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CircleOff,
  Eye,
  Filter,
  FlaskConical,
  Gauge,
  Layers3,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import type {
  AnalysisReport,
  NativeFilterProfile,
  NativeGovernanceStrategy,
  SessionFinding,
} from '@tokray/node';
import { api } from './api';
import { fmtTokens } from './format';
import { useI18n } from './i18n';

interface StrategyCopy {
  title: string;
  detail: string;
}

const RULES_BY_STRATEGY: Readonly<Record<string, readonly string[]>> = {
  'output.filter': ['tool.output-overhead'],
  'context.progressive-disclosure': ['context.persistent-block'],
  'context.deduplicate': ['context.duplicate-content'],
  'tools.schema-gating': ['tool.loaded-never-called'],
  'memory.externalize': ['context.persistent-block'],
  'cache.stable-prefix': ['cache.efficiency'],
  'compaction.protect': ['context.compaction'],
  'workflow.deterministic-offload': [],
};

function strategyCopy(id: string, chinese: boolean): StrategyCopy {
  const values: Record<string, readonly [StrategyCopy, StrategyCopy]> = {
    'output.filter': [
      { title: '工具输出压缩', detail: '确定性移除终端噪声、重复行和低信号进度，同时保留失败窗口与退出码。' },
      { title: 'Tool output filtering', detail: 'Deterministically remove terminal noise, repetition, and low-signal progress while retaining failure windows and exit status.' },
    ],
    'context.progressive-disclosure': [
      { title: '渐进披露', detail: '只在任务需要时加载 Skill、文件和背景资料，避免完整知识长期常驻。' },
      { title: 'Progressive disclosure', detail: 'Load skills, files, and background material only when the task needs them instead of keeping full knowledge resident.' },
    ],
    'context.deduplicate': [
      { title: '上下文去重', detail: '同一调用只保留一份相同内容，并保留其他来源引用。' },
      { title: 'Context deduplication', detail: 'Keep one copy of identical content per call while preserving the other source references.' },
    ],
    'tools.schema-gating': [
      { title: '工具按需加载', detail: '根据任务阶段限制工具 Schema，减少从未调用的常驻定义。' },
      { title: 'On-demand tools', detail: 'Gate tool schemas by task phase to reduce resident definitions that are never called.' },
    ],
    'memory.externalize': [
      { title: '记忆外化', detail: '把长期内容转成可检索引用，仅将相关片段带回当前上下文。' },
      { title: 'Memory externalization', detail: 'Move long-lived content behind retrievable references and return only relevant fragments to the active context.' },
    ],
    'cache.stable-prefix': [
      { title: '缓存前缀稳定', detail: '固定指令和工具顺序，将动态内容后移，提高可复用前缀比例。' },
      { title: 'Stable cache prefix', detail: 'Stabilize instructions and tool order, then move dynamic material later to improve reusable-prefix coverage.' },
    ],
    'compaction.protect': [
      { title: '压缩保护', detail: '在摘要或裁剪前标记关键约束、标识符和失败证据，并检查压缩后命运。' },
      { title: 'Compaction protection', detail: 'Protect critical constraints, identifiers, and failure evidence before summarization, then inspect their fate.' },
    ],
    'workflow.deterministic-offload': [
      { title: '确定性步骤外移', detail: '将重复的解析、筛选、格式化和校验交给脚本，模型只保留语义判断。' },
      { title: 'Deterministic offload', detail: 'Move repeated parsing, filtering, formatting, and validation into scripts while the model keeps semantic judgment.' },
    ],
  };
  const pair = values[id];
  return pair?.[chinese ? 0 : 1] ?? { title: id, detail: id };
}

function findingsFor(strategy: NativeGovernanceStrategy, report: AnalysisReport): SessionFinding[] {
  const rules = new Set(RULES_BY_STRATEGY[strategy.id] ?? []);
  return report.diagnosis.findings.filter((finding) => rules.has(finding.ruleId));
}

export function NativeEnginePanel({
  report,
  onNavigate,
}: {
  report: AnalysisReport;
  onNavigate: (finding: SessionFinding) => void;
}) {
  const { locale } = useI18n();
  const chinese = locale === 'zh-CN';
  const [selectedId, setSelectedId] = useState('output.filter');
  const [profile, setProfile] = useState<NativeFilterProfile>('auto');
  const [command, setCommand] = useState('');
  const [exitCode, setExitCode] = useState('');
  const [output, setOutput] = useState('');
  const strategiesQuery = useQuery({ queryKey: ['native-strategies'], queryFn: api.nativeStrategies, staleTime: Infinity });
  const previewMutation = useMutation({ mutationFn: api.previewNativeFilter });
  const strategies = strategiesQuery.data ?? [];
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? strategies[0];
  const findings = useMemo(() => selected ? findingsFor(selected, report) : [], [report, selected]);
  const result = previewMutation.data;
  const copy = chinese ? {
    title: 'Tokray Native Context Engine', subtitle: '内置、确定性、厂商中立的上下文治理策略', builtin: '内置可用', available: '可预览', diagnose: '已诊断', planned: '规划中', signals: '当前会话信号', noSignals: '当前会话没有命中该策略对应的治理规则', target: '执行位置', risk: '风险', evidence: '证据要求', reversible: '可回退', yes: '是', none: '无', low: '低', medium: '中', high: '高', viewEvidence: '查看证据',
    lab: '输出过滤实验', profile: '策略', auto: '自动识别', generic: '通用长输出', test: '测试输出', build: '构建输出', json: 'JSON / JSONL', gitStatus: 'Git 状态', command: '关联命令（可选）', commandPlaceholder: '例如 pnpm test', exitCode: '退出码', source: '原始工具输出', sourcePlaceholder: '粘贴真实命令、测试、构建或工具返回内容', preview: '生成压缩预览', previewing: '正在分析', original: '原始输出', compact: '治理后输出', saved: '预计减少', reduction: '输出缩减', lossRisk: '信息损失风险', decisions: '执行规则', unchanged: '当前内容无需压缩', methodNote: 'Token 采用 bytes / 4 估算，仅表示工具输出体量，不等于模型输入或账单节省。', lines: '行', bytes: '字节', estimated: '估算 Token',
  } : {
    title: 'Tokray Native Context Engine', subtitle: 'Built-in, deterministic, vendor-neutral context governance strategies', builtin: 'Built in', available: 'Preview ready', diagnose: 'Diagnosing', planned: 'Planned', signals: 'Current-session signals', noSignals: 'This session has no findings mapped to the selected strategy', target: 'Execution target', risk: 'Risk', evidence: 'Required evidence', reversible: 'Reversible', yes: 'Yes', none: 'None', low: 'Low', medium: 'Medium', high: 'High', viewEvidence: 'View evidence',
    lab: 'Output filtering experiment', profile: 'Profile', auto: 'Auto detect', generic: 'Generic long output', test: 'Test output', build: 'Build output', json: 'JSON / JSONL', gitStatus: 'Git status', command: 'Related command (optional)', commandPlaceholder: 'For example: pnpm test', exitCode: 'Exit code', source: 'Raw tool output', sourcePlaceholder: 'Paste real command, test, build, or tool-result output', preview: 'Generate compact preview', previewing: 'Analyzing', original: 'Original output', compact: 'Governed output', saved: 'Estimated reduction', reduction: 'Output reduction', lossRisk: 'Information-loss risk', decisions: 'Applied rules', unchanged: 'This output does not need filtering', methodNote: 'Token uses a bytes / 4 estimate for tool-output volume only; it is not model-input or billing savings.', lines: 'lines', bytes: 'bytes', estimated: 'estimated Tokens',
  };
  const maturityCopy = { available: copy.available, diagnose: copy.diagnose, planned: copy.planned };
  const profileOptions: Array<[NativeFilterProfile, string]> = [
    ['auto', copy.auto], ['generic', copy.generic], ['test', copy.test], ['build', copy.build], ['json', copy.json], ['git-status', copy.gitStatus],
  ];
  const resetPreview = () => previewMutation.reset();
  const runPreview = () => previewMutation.mutate({
    output,
    profile,
    ...(command.trim() ? { command: command.trim() } : {}),
    ...(exitCode.trim() && Number.isInteger(Number(exitCode)) ? { exitCode: Number(exitCode) } : {}),
  });

  return <section className="native-engine" aria-labelledby="native-engine-title">
    <header className="native-engine-heading">
      <div><span><Layers3 size={16} /></span><div><h3 id="native-engine-title">{copy.title}</h3><p>{copy.subtitle}</p></div></div>
      <strong><CheckCircle2 size={13} />{copy.builtin}</strong>
    </header>
    <div className="native-strategy-tabs" role="tablist" aria-label={copy.title}>
      {strategies.map((strategy) => {
        const text = strategyCopy(strategy.id, chinese);
        const count = findingsFor(strategy, report).length;
        return <button type="button" role="tab" aria-selected={strategy.id === selected?.id} className={strategy.id === selected?.id ? 'active' : ''} key={strategy.id} title={text.detail} onClick={() => { setSelectedId(strategy.id); previewMutation.reset(); }}>
          <span>{strategy.maturity === 'available' ? <CheckCircle2 size={12} /> : strategy.maturity === 'diagnose' ? <Gauge size={12} /> : <CircleDashed size={12} />}{text.title}</span>
          <small>{maturityCopy[strategy.maturity]}{count > 0 ? ` · ${count}` : ''}</small>
        </button>;
      })}
    </div>
    {strategiesQuery.isLoading && <div className="native-engine-loading"><LoaderCircle size={15} className="spin" /></div>}
    {selected && <div className="native-strategy-summary">
      <div><strong>{strategyCopy(selected.id, chinese).title}</strong><p>{strategyCopy(selected.id, chinese).detail}</p></div>
      <dl><div><dt>{copy.target}</dt><dd>{selected.target}</dd></div><div><dt>{copy.risk}</dt><dd>{copy[selected.risk]}</dd></div><div><dt>{copy.reversible}</dt><dd>{copy.yes}</dd></div><div><dt>{copy.evidence}</dt><dd>{selected.evidence.length}</dd></div></dl>
    </div>}

    {selected?.id === 'output.filter' && <div className="native-filter-lab">
      <div className="native-filter-controls">
        <div><strong><FlaskConical size={14} />{copy.lab}</strong><span>{copy.methodNote}</span></div>
        <label><span>{copy.profile}</span><select value={profile} onChange={(event) => { setProfile(event.target.value as NativeFilterProfile); resetPreview(); }}>{profileOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>{copy.command}</span><input value={command} onChange={(event) => { setCommand(event.target.value); resetPreview(); }} placeholder={copy.commandPlaceholder} /></label>
        <label className="native-exit-code"><span>{copy.exitCode}</span><input inputMode="numeric" value={exitCode} onChange={(event) => { setExitCode(event.target.value.replace(/[^0-9-]/g, '')); resetPreview(); }} placeholder="0" /></label>
      </div>
      <label className="native-output-input"><span>{copy.source}</span><textarea value={output} onChange={(event) => { setOutput(event.target.value); resetPreview(); }} placeholder={copy.sourcePlaceholder} maxLength={1_000_000} /></label>
      <div className="native-filter-action"><span>{output.length.toLocaleString(locale)} chars</span><button type="button" className="primary-command" disabled={!output || previewMutation.isPending} onClick={runPreview}>{previewMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Filter size={14} />}{previewMutation.isPending ? copy.previewing : copy.preview}</button></div>
      {previewMutation.error && <div className="native-filter-error"><CircleOff size={13} />{previewMutation.error.message}</div>}
      {result && <div className="native-filter-result">
        <div className="native-filter-metrics">
          <div><span>{copy.original}</span><strong>{fmtTokens(result.original.estimatedTokens)}</strong><small>{result.original.bytes} {copy.bytes} · {result.original.lines} {copy.lines}</small></div>
          <ArrowRight size={15} />
          <div><span>{copy.compact}</span><strong>{fmtTokens(result.compact.estimatedTokens)}</strong><small>{result.compact.bytes} {copy.bytes} · {result.compact.lines} {copy.lines}</small></div>
          <div><span>{copy.saved}</span><strong>{fmtTokens(result.estimatedSavedTokens)}</strong><small>{Math.round(result.outputReductionPercentage)}% {copy.reduction}</small></div>
          <div><span>{copy.lossRisk}</span><strong className={`native-risk-${result.lossRisk}`}>{copy[result.lossRisk]}</strong><small>{result.informationPolicy}</small></div>
        </div>
        {result.changed ? <>
          <div className="native-output-compare"><article><span>{copy.original}</span><pre>{output}</pre></article><article><span>{copy.compact}</span><pre>{result.output}</pre></article></div>
          <div className="native-decisions"><strong><ShieldCheck size={13} />{copy.decisions}</strong>{result.decisions.map((decision) => <code key={decision.id}>{decision.id} · {decision.affectedLines}</code>)}</div>
        </> : <div className="native-filter-unchanged"><CheckCircle2 size={14} />{copy.unchanged}</div>}
      </div>}
    </div>}

    {selected?.id !== 'output.filter' && <div className="native-session-signals">
      <header><Gauge size={14} /><strong>{copy.signals}</strong><span>{findings.length}</span></header>
      {findings.length === 0 ? <p>{copy.noSignals}</p> : findings.map((finding) => <article key={finding.ruleId}>
        <div><strong>{finding.ruleId}</strong><span>{finding.evidence.length} evidence · {finding.confidence}</span></div>
        <button type="button" onClick={() => onNavigate(finding)}><Eye size={13} />{copy.viewEvidence}</button>
      </article>)}
    </div>}
  </section>;
}
