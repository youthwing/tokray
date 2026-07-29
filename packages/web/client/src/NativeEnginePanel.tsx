import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CircleOff,
  Clipboard,
  ClipboardCheck,
  FileJson2,
  Eye,
  Filter,
  FlaskConical,
  Gauge,
  Layers3,
  LoaderCircle,
  Play,
  PlugZap,
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
import { HelpTip } from './HelpTip';
import { useI18n } from './i18n';

interface StrategyCopy {
  title: string;
  detail: string;
}

const RULES_BY_STRATEGY: Readonly<Record<string, readonly string[]>> = {
  'request.govern': ['tool.loaded-never-called'],
  'output.filter': ['tool.output-overhead'],
  'context.progressive-disclosure': ['context.persistent-block'],
  'context.deduplicate': ['context.duplicate-content'],
  'tools.schema-gating': ['tool.loaded-never-called'],
  'memory.externalize': ['context.persistent-block'],
  'cache.stable-prefix': ['cache.efficiency'],
  'compaction.protect': ['context.compaction'],
  'workflow.deterministic-offload': [],
};

const OPENAI_REQUEST_SAMPLE = {
  model: 'gpt-5',
  messages: [
    { role: 'system', content: 'You are a careful coding agent.' },
    { role: 'user', content: 'Inspect the repository and explain the failing test.' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Please simply read a file in order to return its complete contents to the caller.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Please provide the exact file path such as ./src/main.ts.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_code',
        description: 'Please search source files in order to find matching text and return the matching lines.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Please provide the text to search for.' } },
          required: ['query'],
        },
      },
    },
  ],
};

const ANTHROPIC_REQUEST_SAMPLE = {
  model: 'claude-sonnet-4',
  max_tokens: 1024,
  system: 'You are a careful coding agent.',
  messages: [{ role: 'user', content: 'Inspect the repository and explain the failing test.' }],
  tools: [
    {
      name: 'read_file',
      description: 'Please simply read a file in order to return its complete contents to the caller.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Please provide the exact file path such as ./src/main.ts.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  ],
};

function requestSample(format: 'openai' | 'anthropic'): string {
  return JSON.stringify(format === 'openai' ? OPENAI_REQUEST_SAMPLE : ANTHROPIC_REQUEST_SAMPLE, null, 2);
}

function strategyCopy(id: string, chinese: boolean): StrategyCopy {
  const values: Record<string, readonly [StrategyCopy, StrategyCopy]> = {
    'request.govern': [
      { title: '模型请求治理', detail: '在请求发送前压缩工具描述、移除完全重复定义、应用显式工具白名单，并用输入预算决定是否允许发送。' },
      { title: 'Model request governance', detail: 'Before sending, compact tool descriptions, remove exact duplicates, apply an explicit tool allowlist, and enforce an estimated input budget.' },
    ],
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

function requestDecisionLabel(id: string, chinese: boolean): string {
  const values: Record<string, readonly [string, string]> = {
    'compact-tool-descriptions': ['压缩自然语言工具描述', 'Compact natural-language tool descriptions'],
    'deduplicate-exact-tool-schemas': ['移除完全相同的工具定义', 'Remove byte-identical tool definitions'],
    'apply-explicit-tool-allowlist': ['应用显式工具白名单', 'Apply the explicit tool allowlist'],
    'enforce-input-budget': ['检查估算输入预算', 'Enforce the estimated input budget'],
  };
  return values[id]?.[chinese ? 0 : 1] ?? id;
}

function requestWarningLabel(id: string, chinese: boolean): string {
  const values: Record<string, readonly [string, string]> = {
    'token-budget-uses-char-class-estimate': ['预算依据 char-class-v1 估算，不等同于供应商 tokenizer 或账单 Usage。', 'The budget uses a char-class-v1 estimate, not provider tokenizer or billing Usage.'],
    'unnamed-tools-retained-outside-allowlist': ['检测到无名称工具；为避免破坏未知契约，白名单未移除它们。', 'Unnamed tools were retained outside the allowlist to avoid breaking an unknown contract.'],
    'request-blocked-by-estimated-input-budget': ['治理后请求仍超过估算预算，sendAllowed 已设为 false。', 'The governed request still exceeds the estimate budget, so sendAllowed is false.'],
  };
  return values[id]?.[chinese ? 0 : 1] ?? id;
}

function findingsFor(strategy: NativeGovernanceStrategy, report: AnalysisReport): SessionFinding[] {
  const rules = new Set(RULES_BY_STRATEGY[strategy.id] ?? []);
  return report.diagnosis.findings.filter((finding) => rules.has(finding.ruleId));
}

export function NativeEnginePanel({
  report,
  onNavigate,
  onOpenAutomation,
}: {
  report: AnalysisReport;
  onNavigate: (finding: SessionFinding) => void;
  onOpenAutomation: () => void;
}) {
  const { locale } = useI18n();
  const chinese = locale === 'zh-CN';
  const [selectedId, setSelectedId] = useState('request.govern');
  const [requestFormat, setRequestFormat] = useState<'openai' | 'anthropic' | 'custom'>('openai');
  const [requestText, setRequestText] = useState(() => requestSample('openai'));
  const [maxInputTokens, setMaxInputTokens] = useState('8000');
  const [allowedTools, setAllowedTools] = useState('');
  const [compactDescriptions, setCompactDescriptions] = useState(true);
  const [deduplicateTools, setDeduplicateTools] = useState(true);
  const [requestError, setRequestError] = useState<string>();
  const [requestCopied, setRequestCopied] = useState(false);
  const [profile, setProfile] = useState<NativeFilterProfile>('auto');
  const [command, setCommand] = useState('');
  const [exitCode, setExitCode] = useState('');
  const [output, setOutput] = useState('');
  const strategiesQuery = useQuery({ queryKey: ['native-strategies'], queryFn: api.nativeStrategies, staleTime: Infinity });
  const requestPreviewMutation = useMutation({ mutationFn: api.previewNativeRequest });
  const previewMutation = useMutation({ mutationFn: api.previewNativeFilter });
  const strategies = strategiesQuery.data ?? [];
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? strategies[0];
  const findings = useMemo(() => selected ? findingsFor(selected, report) : [], [report, selected]);
  const requestResult = requestPreviewMutation.data;
  const result = previewMutation.data;
  const copy = chinese ? {
    title: '手动策略预演', subtitle: '在本地验证策略，不影响 Codex 的真实调用', builtin: '仅预演', available: '可预览', diagnose: '已诊断', planned: '规划中', signals: '当前会话信号', noSignals: '当前会话没有命中该策略对应的治理规则', target: '执行位置', risk: '风险', evidence: '证据要求', reversible: '可回退', yes: '是', none: '无', low: '低', medium: '中', high: '高', viewEvidence: '查看证据', previewMode: '当前：手动预演', previewModeDetail: '这里的操作只生成对比结果。', openAutomation: '配置自动治理',
    requestLab: '完整请求预演', requestLabNote: '生成可交给模型 API 的候选 JSON；Codex 当前没有可接入的请求前 Hook。', openaiFormat: 'OpenAI 格式', anthropicFormat: 'Anthropic 格式', inputBudget: '输入预算', inputBudgetHelp: '使用本地 char-class-v1 估算器检查序列化请求体。超过预算时阻止发送，但不会截断消息。', noBudget: '留空则不阻止', toolAllowlist: '工具白名单', toolAllowlistHelp: '只有显式填写时才移除未列出的具名工具。无名称的工具会保留并产生警告。', allowlistPlaceholder: '留空保留全部；例：read_file,search_code', compactDescriptions: '压缩工具描述', deduplicateTools: '移除完全重复工具', requestJson: '模型请求 JSON', requestJsonHelp: '支持 OpenAI 与 Anthropic 兼容请求体，也支持包含 request 字段的捕获信封。', previewRequest: '生成治理预览', governing: '正在生成', invalidRequest: '请求必须是有效的 JSON 对象', invalidBudget: '输入预算必须是正整数', chars: '字符', sendReady: '允许发送', candidateReady: '候选已生成', sendBlocked: '已阻止发送', sendBlockedDetail: '治理后估算输入仍超过预算', originalRequest: '原始请求', governedRequest: '治理后请求', estimatedInput: '估算输入', estimatedInputHelp: '估算范围是序列化请求体，不等价于供应商 tokenizer 结果或账单 Usage。', toolSet: '工具集合', toolsUnit: '个工具', descriptionFields: '描述字段', exactDuplicates: '完全重复', allowlistRemoved: '白名单移除', providerFormat: '请求格式', budgetStatus: '预算状态', decisionLog: '治理决策', integrity: '完整性保证', messagesPreserved: 'system / messages / input 未改动', contractsPreserved: '保留工具的参数契约未改动', originalPreserved: '原始输入对象未改动', warnings: '边界与警告', copyRequest: '复制治理后请求', copiedRequest: '已复制', requestMethod: 'char-class-v1 估算 · 非账单等价', noRequestChanges: '当前请求无需改写；仍已完成完整性与预算检查。',
    lab: '工具输出预演', profile: '策略', auto: '自动识别', generic: '通用长输出', test: '测试输出', build: '构建输出', json: 'JSON / JSONL', gitStatus: 'Git 状态', command: '关联命令（可选）', commandPlaceholder: '例如 pnpm test', exitCode: '退出码', source: '原始工具输出', sourcePlaceholder: '粘贴真实命令、测试、构建或工具返回内容', preview: '生成过滤预览', previewing: '正在分析', original: '原始输出', compact: '治理后输出', saved: '预计减少', reduction: '输出缩减', lossRisk: '信息损失风险', decisions: '执行规则', unchanged: '当前内容无需压缩', methodNote: 'Token 采用 bytes / 4 估算，仅表示工具输出体量，不等于模型输入或账单节省。', lines: '行', bytes: '字节', estimated: '估算 Token',
  } : {
    title: 'Manual strategy preview', subtitle: 'Validate policies locally without changing live Codex calls', builtin: 'Preview only', available: 'Preview ready', diagnose: 'Diagnosing', planned: 'Planned', signals: 'Current-session signals', noSignals: 'This session has no findings mapped to the selected strategy', target: 'Execution target', risk: 'Risk', evidence: 'Required evidence', reversible: 'Reversible', yes: 'Yes', none: 'None', low: 'Low', medium: 'Medium', high: 'High', viewEvidence: 'View evidence', previewMode: 'Current: manual preview', previewModeDetail: 'Actions here only generate before-and-after results.', openAutomation: 'Configure automatic governance',
    requestLab: 'Full-request preview', requestLabNote: 'Produce candidate JSON for a model API. Codex currently exposes no pre-request Hook for this path.', openaiFormat: 'OpenAI format', anthropicFormat: 'Anthropic format', inputBudget: 'Input budget', inputBudgetHelp: 'Checks the serialized request with the local char-class-v1 estimator. An over-budget result blocks sending without truncating messages.', noBudget: 'Blank does not block', toolAllowlist: 'Tool allowlist', toolAllowlistHelp: 'Named tools are removed only when an allowlist is explicitly supplied. Unnamed tools remain and produce a warning.', allowlistPlaceholder: 'Blank keeps all; e.g. read_file,search_code', compactDescriptions: 'Compact tool descriptions', deduplicateTools: 'Remove exact duplicate tools', requestJson: 'Model request JSON', requestJsonHelp: 'Accepts OpenAI- and Anthropic-compatible bodies, including capture envelopes with a request field.', previewRequest: 'Generate governance preview', governing: 'Generating preview', invalidRequest: 'The request must be a valid JSON object', invalidBudget: 'The input budget must be a positive integer', chars: 'characters', sendReady: 'Send allowed', candidateReady: 'Candidate ready', sendBlocked: 'Send blocked', sendBlockedDetail: 'The governed input estimate still exceeds the budget', originalRequest: 'Original request', governedRequest: 'Governed request', estimatedInput: 'Estimated input', estimatedInputHelp: 'The scope is the serialized request body, not provider-tokenizer output or billing Usage.', toolSet: 'Tool set', toolsUnit: 'tools', descriptionFields: 'description fields', exactDuplicates: 'exact duplicates', allowlistRemoved: 'allowlist removed', providerFormat: 'Request format', budgetStatus: 'Budget status', decisionLog: 'Governance decisions', integrity: 'Integrity guarantees', messagesPreserved: 'system / messages / input unchanged', contractsPreserved: 'Retained tool parameter contracts unchanged', originalPreserved: 'Original input object unchanged', warnings: 'Boundaries and warnings', copyRequest: 'Copy governed request', copiedRequest: 'Copied', requestMethod: 'char-class-v1 estimate · not billing-equivalent', noRequestChanges: 'No rewrite was needed; integrity and budget checks still ran.',
    lab: 'Tool-output preview', profile: 'Profile', auto: 'Auto detect', generic: 'Generic long output', test: 'Test output', build: 'Build output', json: 'JSON / JSONL', gitStatus: 'Git status', command: 'Related command (optional)', commandPlaceholder: 'For example: pnpm test', exitCode: 'Exit code', source: 'Raw tool output', sourcePlaceholder: 'Paste real command, test, build, or tool-result output', preview: 'Generate filter preview', previewing: 'Analyzing', original: 'Original output', compact: 'Governed output', saved: 'Estimated reduction', reduction: 'output reduction', lossRisk: 'Information-loss risk', decisions: 'Applied rules', unchanged: 'This output does not need filtering', methodNote: 'Token uses a bytes / 4 estimate for tool-output volume only; it is not model-input or billing savings.', lines: 'lines', bytes: 'bytes', estimated: 'estimated Tokens',
  };
  const maturityCopy = { available: copy.available, diagnose: copy.diagnose, planned: copy.planned };
  const profileOptions: Array<[NativeFilterProfile, string]> = [
    ['auto', copy.auto], ['generic', copy.generic], ['test', copy.test], ['build', copy.build], ['json', copy.json], ['git-status', copy.gitStatus],
  ];
  const resetPreview = () => previewMutation.reset();
  const resetRequestPreview = () => {
    requestPreviewMutation.reset();
    setRequestError(undefined);
    setRequestCopied(false);
  };
  const loadRequestSample = (format: 'openai' | 'anthropic') => {
    setRequestFormat(format);
    setRequestText(requestSample(format));
    setAllowedTools('');
    resetRequestPreview();
  };
  const runRequestPreview = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(requestText);
    } catch {
      setRequestError(copy.invalidRequest);
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setRequestError(copy.invalidRequest);
      return;
    }
    const budget = maxInputTokens.trim() ? Number(maxInputTokens) : undefined;
    if (budget !== undefined && (!Number.isInteger(budget) || budget <= 0)) {
      setRequestError(copy.invalidBudget);
      return;
    }
    const allowlist = allowedTools.trim()
      ? allowedTools.split(',').map((name) => name.trim()).filter(Boolean)
      : undefined;
    setRequestError(undefined);
    requestPreviewMutation.mutate({
      request: parsed as Record<string, unknown>,
      ...(budget !== undefined ? { maxInputTokens: budget } : {}),
      ...(allowlist !== undefined ? { allowedTools: allowlist } : {}),
      compactToolDescriptions: compactDescriptions,
      deduplicateTools,
    });
  };
  const copyGovernedRequest = async () => {
    const governed = requestPreviewMutation.data?.request;
    if (!governed) return;
    await navigator.clipboard.writeText(JSON.stringify(governed, null, 2));
    setRequestCopied(true);
  };
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
    <div className="native-preview-mode">
      <div><FlaskConical size={15} /><span><strong>{copy.previewMode}</strong><small>{copy.previewModeDetail}</small></span></div>
      <button type="button" className="secondary-command" onClick={onOpenAutomation}><PlugZap size={14} />{copy.openAutomation}</button>
    </div>
    <div className="native-strategy-tabs" role="tablist" aria-label={copy.title}>
      {strategies.map((strategy) => {
        const text = strategyCopy(strategy.id, chinese);
        const count = findingsFor(strategy, report).length;
        return <button type="button" role="tab" aria-selected={strategy.id === selected?.id} className={strategy.id === selected?.id ? 'active' : ''} key={strategy.id} title={text.detail} onClick={() => { setSelectedId(strategy.id); previewMutation.reset(); resetRequestPreview(); }}>
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

    {selected?.id === 'request.govern' && <div className="native-request-lab">
      <div className="native-request-controls">
        <div className="native-request-intro"><strong><FileJson2 size={14} />{copy.requestLab}</strong><span>{copy.requestLabNote}</span></div>
        <div className="native-request-format" role="group" aria-label={copy.providerFormat}>
          <button type="button" className={requestFormat === 'openai' ? 'active' : ''} onClick={() => loadRequestSample('openai')}>{copy.openaiFormat}</button>
          <button type="button" className={requestFormat === 'anthropic' ? 'active' : ''} onClick={() => loadRequestSample('anthropic')}>{copy.anthropicFormat}</button>
        </div>
        <label className="native-budget-input"><span>{copy.inputBudget}<HelpTip content={copy.inputBudgetHelp} /></span><input inputMode="numeric" value={maxInputTokens} onChange={(event) => { setMaxInputTokens(event.target.value.replace(/[^0-9]/g, '')); resetRequestPreview(); }} placeholder={copy.noBudget} /></label>
      </div>
      <div className="native-request-policy">
        <label className="native-allowlist-input"><span>{copy.toolAllowlist}<HelpTip content={copy.toolAllowlistHelp} /></span><input value={allowedTools} onChange={(event) => { setAllowedTools(event.target.value); resetRequestPreview(); }} placeholder={copy.allowlistPlaceholder} /></label>
        <label className="native-policy-check"><input type="checkbox" checked={compactDescriptions} onChange={(event) => { setCompactDescriptions(event.target.checked); resetRequestPreview(); }} /><span>{copy.compactDescriptions}</span></label>
        <label className="native-policy-check"><input type="checkbox" checked={deduplicateTools} onChange={(event) => { setDeduplicateTools(event.target.checked); resetRequestPreview(); }} /><span>{copy.deduplicateTools}</span></label>
      </div>
      <label className="native-request-input"><span>{copy.requestJson}<HelpTip content={copy.requestJsonHelp} /></span><textarea spellCheck={false} value={requestText} onChange={(event) => { setRequestText(event.target.value); setRequestFormat('custom'); resetRequestPreview(); }} maxLength={2_000_000} /></label>
      <div className="native-filter-action"><span>{requestText.length.toLocaleString(locale)} {copy.chars}</span><button type="button" className="primary-command" disabled={!requestText.trim() || requestPreviewMutation.isPending} onClick={runRequestPreview}>{requestPreviewMutation.isPending ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}{requestPreviewMutation.isPending ? copy.governing : copy.previewRequest}</button></div>
      {(requestError || requestPreviewMutation.error) && <div className="native-filter-error"><CircleOff size={13} />{requestError ?? requestPreviewMutation.error?.message}</div>}

      {requestResult && <div className="native-request-result">
        <header className={`native-request-gate ${requestResult.budget.sendAllowed ? 'gate-allowed' : 'gate-blocked'}`}>
          <div>{requestResult.budget.sendAllowed ? <ShieldCheck size={16} /> : <CircleOff size={16} />}<span><strong>{requestResult.budget.sendAllowed ? requestResult.budget.status === 'not-set' ? copy.candidateReady : copy.sendReady : copy.sendBlocked}</strong><small>{requestResult.budget.sendAllowed ? copy.requestMethod : copy.sendBlockedDetail}</small></span></div>
          <button type="button" className="secondary-command" onClick={() => void copyGovernedRequest()}>{requestCopied ? <ClipboardCheck size={14} /> : <Clipboard size={14} />}{requestCopied ? copy.copiedRequest : copy.copyRequest}</button>
        </header>
        <div className="native-request-metrics">
          <div><span>{copy.originalRequest} · {copy.estimatedInput}<HelpTip content={copy.estimatedInputHelp} /></span><strong>{fmtTokens(requestResult.original.estimatedTokens.value)}</strong><small>{requestResult.original.serializedBytes.toLocaleString(locale)} {copy.bytes}</small></div>
          <div><span>{copy.governedRequest} · {copy.estimatedInput}</span><strong>{fmtTokens(requestResult.governed.estimatedTokens.value)}</strong><small>{requestResult.governed.serializedBytes.toLocaleString(locale)} {copy.bytes}</small></div>
          <div><span>{copy.saved}</span><strong>{fmtTokens(requestResult.estimatedSavedTokens)}</strong><small>{requestResult.reductionPercentage.toFixed(1)}% {copy.reduction}</small></div>
          <div><span>{copy.toolSet}</span><strong>{requestResult.tools.originalCount} <ArrowRight size={12} /> {requestResult.tools.governedCount}</strong><small>{requestResult.tools.descriptionFieldsCompacted} {copy.descriptionFields}</small></div>
        </div>
        <dl className="native-request-facts">
          <div><dt>{copy.providerFormat}</dt><dd>{requestResult.requestProvider}</dd></div>
          <div><dt>{copy.budgetStatus}</dt><dd>{requestResult.budget.status}{requestResult.budget.maxInputTokens ? ` · ${fmtTokens(requestResult.budget.maxInputTokens)}` : ''}</dd></div>
          <div><dt>{copy.exactDuplicates}</dt><dd>{requestResult.tools.exactDuplicatesRemoved}</dd></div>
          <div><dt>{copy.allowlistRemoved}</dt><dd>{requestResult.tools.allowlistRemoved.length}</dd></div>
        </dl>
        <div className="native-request-integrity">
          <strong>{copy.integrity}<HelpTip content={copy.requestJsonHelp} /></strong>
          <span><CheckCircle2 size={13} />{copy.messagesPreserved}</span>
          <span><CheckCircle2 size={13} />{copy.contractsPreserved}</span>
          <span><CheckCircle2 size={13} />{copy.originalPreserved}</span>
        </div>
        <div className="native-request-decisions">
          <div><strong><ShieldCheck size={13} />{copy.decisionLog}</strong>{requestResult.decisions.length === 0 && <span>{copy.noRequestChanges}</span>}</div>
          {requestResult.decisions.map((decision) => <div key={decision.id}><code>{decision.id}</code><span>{requestDecisionLabel(decision.id, chinese)}</span><small>{decision.affectedTools} {chinese ? copy.toolsUnit : decision.affectedTools === 1 ? 'tool' : 'tools'} · {decision.affectedFields} {chinese ? copy.descriptionFields : decision.affectedFields === 1 ? 'description field' : 'description fields'}</small></div>)}
        </div>
        <div className="native-request-warnings">
          <strong><AlertTriangle size={13} />{copy.warnings}</strong>
          {requestResult.warnings.map((warning) => <span key={warning}>{requestWarningLabel(warning, chinese)}</span>)}
        </div>
        <div className="native-output-compare native-request-compare"><article><span>{copy.originalRequest}</span><pre>{requestText}</pre></article><article><span>{copy.governedRequest}</span><pre>{JSON.stringify(requestResult.request, null, 2)}</pre></article></div>
      </div>}
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
