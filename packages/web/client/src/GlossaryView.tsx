import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { useI18n } from './i18n';

type GlossaryTerm = {
  term: string;
  aliases: string;
  category: string;
  definition: string;
  calculation: string;
  source: string;
  limit: string;
};

const enTerms: GlossaryTerm[] = [
  { term: 'ContextFrame', aliases: 'call frame request', category: 'Context', definition: 'One model call and the reconstructed context visible to that call.', calculation: 'One emitted frame per actual model request.', source: 'Agent log or complete request capture.', limit: 'Hidden provider content cannot be reconstructed.' },
  { term: 'Input tokens', aliases: 'prompt tokens context', category: 'Usage', definition: 'Normalized model-visible prompt volume for a call.', calculation: 'Provider input plus cache tokens only when the provider reports cache outside its input field.', source: 'Provider API/log; otherwise marked estimated.', limit: 'Provider cache semantics differ and remain explicit.' },
  { term: 'Cache read', aliases: 'cached input prompt cache', category: 'Cache', definition: 'Input tokens served from a reusable prompt cache.', calculation: 'Provider cache_read or cached_tokens field.', source: 'Provider Usage only.', limit: 'A high cache count does not prove the uncached suffix is efficient.' },
  { term: 'Cache write', aliases: 'cache creation', category: 'Cache', definition: 'Tokens used to populate a reusable prompt cache.', calculation: 'Provider cache creation/write field.', source: 'Provider Usage when exposed.', limit: 'Not every provider exposes cache writes.' },
  { term: 'Resident layer', aliases: 'system overhead persistent', category: 'Context', definition: 'Persistent input not reconstructed as conversation blocks, such as hidden instructions or schemas.', calculation: 'Provider input minus calibrated visible content.', source: 'Usage-calibrated estimate.', limit: 'With weak calibration the value is withheld instead of shown precisely.' },
  { term: 'Visible estimate', aliases: 'reconstructed blocks', category: 'Evidence', definition: 'Token estimate for message, tool, file, and summary blocks present in the log.', calculation: 'Block token counts scaled within a calibration epoch.', source: 'Local text plus tokenizer/heuristic evidence.', limit: 'Image and schema priors carry error bands.' },
  { term: 'Calibration r2', aliases: 'r-squared fit', category: 'Evidence', definition: 'How well visible reconstructed tokens explain provider input within an epoch.', calculation: 'Coefficient of determination for the fitted scale and resident term.', source: 'Multiple calls with provider Usage.', limit: 'A high fit supports accounting, not semantic correctness.' },
  { term: 'Confidence', aliases: 'exact inferred guessed', category: 'Evidence', definition: 'How directly an attribution or finding is supported.', calculation: 'Exact from source; inferred by deterministic evidence; guessed by heuristic/prior.', source: 'Adapter and governance rule.', limit: 'Confidence is not probability.' },
  { term: 'Compaction', aliases: 'context compression summary', category: 'Compaction', definition: 'An observed boundary where prior context is reduced or summarized.', calculation: 'Before/after frames are aligned into kept, summarized, truncated, dropped, added, or unobserved fates.', source: 'Agent marker plus block evidence.', limit: 'Without a logged summary body, unmatched history remains unobserved.' },
  { term: 'SourceRef', aliases: 'source pointer evidence', category: 'Evidence', definition: 'A structural reference back to the local source record for a block.', calculation: 'Source id, record ordinal, and JSON Pointer or byte range.', source: 'Adapter parser.', limit: 'It points to evidence; raw content is read only on demand.' },
  { term: 'Agent', aliases: 'harness client runtime', category: 'Identity', definition: 'The client or runtime assembling a model request, such as Codex or Trae.', calculation: 'Recorded separately from the model provider.', source: 'Adapter/source identity.', limit: 'One Agent can use multiple providers.' },
  { term: 'Model provider', aliases: 'vendor api', category: 'Identity', definition: 'The API or model vendor, such as OpenAI, Anthropic, DeepSeek, or Google.', calculation: 'Read from request/log metadata where available.', source: 'Provider or Agent record.', limit: 'Provider is never inferred from the Agent name alone.' },
  { term: 'Tool schema', aliases: 'function definition mcp', category: 'Tools', definition: 'The model-visible definition of a callable tool.', calculation: 'Exact from a request capture or estimated by a named prior when only the tool name is logged.', source: 'Request tools array or Agent roster.', limit: 'A prior is not exact Usage.' },
  { term: 'Duplicate context', aliases: 'duplicate content repeated block', category: 'Governance', definition: 'Multiple separately recorded blocks with the same content coexist in one model call.', calculation: 'Group eligible blocks by content fingerprint inside each ContextFrame; one copy is retained and the remainder is estimated waste.', source: 'Block hashes and SourceRef evidence.', limit: 'Fingerprint equality is inferred evidence; the rule ignores small duplicates and conversational prose.' },
  { term: 'Loaded but never called', aliases: 'idle tool unused schema', category: 'Governance', definition: 'A tool schema was observed loading but no matching call occurred in the session.', calculation: 'Exact set difference between the loaded and called tool rosters.', source: 'Agent roster and tool-call records.', limit: 'The finding is exact; its Schema Token cost can still be a prior.' },
  { term: 'ActionProposal', aliases: 'action preview governance recommendation', category: 'Governance', definition: 'An evidence-linked proposal describing what could change, where it would execute, and which capability it requires.', calculation: 'Built deterministically from one GovernanceFinding and the selected Agent capability matrix.', source: 'Governance rule plus AgentCapabilities.', limit: 'A proposal is not an applied change; its availability must be shown explicitly.' },
  { term: 'Execution target', aliases: 'apply location control plane', category: 'Governance', definition: 'The boundary where an approved optimization would run, such as Agent configuration, a tool Hook, or a request proxy.', calculation: 'Resolved from the stable action id, independently from the Agent vendor.', source: 'Tokray action registry.', limit: 'Historical logs remain immutable and are never used as an execution target.' },
  { term: 'Hook Bridge', aliases: 'agent hook runtime bridge action provider', category: 'Governance', definition: 'A local dispatch boundary through which an Agent-native Hook can request Tokray output filtering or an RTK command rewrite.', calculation: 'Tokray registers an Agent and Provider pair, then dispatches only when that pair is enabled.', source: 'Tokray bridge registry plus the Agent Hook/config interface.', limit: 'Registered means Tokray is ready; it does not prove the vendor-native Hook is connected.' },
  { term: 'Native Request Governor', aliases: 'model request budget tool allowlist request proxy', category: 'Governance', definition: 'Tokray\'s vendor-neutral pre-request transform for OpenAI- and Anthropic-compatible model requests.', calculation: 'Preserve message fields, compact natural-language tool descriptions, remove exact duplicate definitions, apply an explicit allowlist, then evaluate an estimated input budget.', source: 'Complete request JSON plus user-supplied governance options.', limit: 'The estimate covers serialized request content and is not provider-tokenizer or billing Usage; without a connected Hook or proxy, Tokray returns a governed candidate rather than intercepting an Agent automatically.' },
  { term: 'Native output filter', aliases: 'tokray native tool output compression', category: 'Governance', definition: 'Tokray\'s deterministic post-tool transform for reducing terminal noise before output enters a model request.', calculation: 'Normalize ANSI/progress noise, fold repetition, and retain profile-specific diagnostic windows with explicit omission markers.', source: 'Raw tool output, optional command, and exit code.', limit: 'Its bytes / 4 estimate measures tool-output volume, not provider billing or verified model-input savings.' },
  { term: 'Strategy maturity', aliases: 'available diagnose planned status', category: 'Governance', definition: 'The implementation state of a native governance surface.', calculation: 'Available can transform; diagnose only links findings to evidence; planned has no shipped diagnosis or transform.', source: 'Tokray native strategy registry.', limit: 'Maturity is capability status, not quality or impact score.' },
  { term: 'Progressive disclosure', aliases: 'on demand retrieval context selection', category: 'Governance', definition: 'Keep summaries or references in the prompt and retrieve full content only when the task needs it.', calculation: 'Compare always-resident content with later references and retrieval paths.', source: 'Block lifecycle and SourceRef evidence.', limit: 'Tokray currently presents this as planned, not an active transform.' },
  { term: 'Memory externalization', aliases: 'persistent context file retrieval', category: 'Governance', definition: 'Move long-lived context out of every request into a file, memory store, or on-demand reference.', calculation: 'Identify large blocks that survive many calls but are rarely referenced.', source: 'Resident-frame and last-reference evidence.', limit: 'Tokray diagnoses candidates but does not currently rewrite Agent memory.' },
  { term: 'Stable cache prefix', aliases: 'prompt cache request prefix', category: 'Governance', definition: 'Keep static instructions, schemas, and ordering stable at the start of requests so provider caches can be reused.', calculation: 'Compare cache reads and uncached input across model and request-structure boundaries.', source: 'Provider Usage and reconstructed call boundaries.', limit: 'Cache behavior is provider-specific; diagnosis does not prove causality.' },
  { term: 'Deterministic workflow offload', aliases: 'orchestration scripts model calls', category: 'Governance', definition: 'Move repeatable mechanical steps to scripts or APIs while retaining model calls for semantic judgment.', calculation: 'Find repeated tool sequences whose outputs and branching can be specified deterministically.', source: 'Tool sequence and model-call boundary evidence.', limit: 'This surface is planned and Tokray is not a general-purpose workflow builder.' },
  { term: 'ActionReceipt', aliases: 'receipt rollback audit action log', category: 'Governance', definition: 'An immutable local record written after an explicitly approved governance action finishes.', calculation: 'Records action, target, timestamps, redacted changes, result metrics, and rollback availability.', source: 'Tokray action provider.', limit: 'A receipt proves Tokray executed the described local action, not that later model quality improved.' },
  { term: 'RTK gain', aliases: 'rust token killer output reduction bytes 4', category: 'Governance', definition: 'RTK analytics for the reduction between raw and filtered Bash command output.', calculation: 'RTK estimates raw and compact output as bytes / 4 and reports their difference.', source: 'rtk gain --all --format json.', limit: 'It is Bash-output reduction, not verified model-input or billing savings.' },
  { term: 'RTK rewrite preview', aliases: 'command rewrite hook preview', category: 'Governance', definition: 'A read-only check of how RTK would rewrite a shell command.', calculation: 'Tokray invokes rtk rewrite with the command as one process argument.', source: 'Official RTK binary.', limit: 'The preview never executes the original or rewritten command.' },
  { term: 'RTK output comparison', aliases: 'raw compact experiment bytes token', category: 'Governance', definition: 'An explicitly approved experiment that runs an allowlisted read-only command and its RTK rewrite once each.', calculation: 'Compares exit code, duration, output bytes, lines, and bytes / 4 estimates.', source: 'Captured local process output.', limit: 'It executes two commands; output reduction is still not verified model-input or billing savings.' },
  { term: 'Unobserved', aliases: 'unknown missing', category: 'Evidence', definition: 'A state whose outcome cannot be distinguished from available evidence.', calculation: 'Used when multiple outcomes remain possible.', source: 'Missing fields or incomplete boundaries.', limit: 'Unobserved is intentionally not treated as zero or dropped.' },
];

const zhTerms: GlossaryTerm[] = [
  { term: 'ContextFrame（上下文帧）', aliases: '调用 请求 frame', category: '上下文', definition: '一次真实模型调用，以及该次调用可见的重建上下文。', calculation: '每个实际模型请求生成一个 Frame。', source: 'Agent 日志或完整请求捕获。', limit: '供应商未记录的隐藏内容无法恢复。' },
  { term: '输入 Token', aliases: '提示词 上下文 input', category: 'Usage', definition: '一次调用中模型实际可见的标准化提示词总量。', calculation: '仅在供应商把缓存排除在输入字段外时，将缓存 Token 加回。', source: '供应商 API/日志；否则明确标记为估算。', limit: '不同供应商的缓存口径不会被模糊合并。' },
  { term: '缓存读取', aliases: 'cache read cached prompt', category: '缓存', definition: '由可复用提示缓存提供的输入 Token。', calculation: '读取供应商 cache_read 或 cached_tokens 字段。', source: '仅来自供应商 Usage。', limit: '缓存命中高不代表非缓存后缀一定高效。' },
  { term: '缓存写入', aliases: 'cache write creation', category: '缓存', definition: '用于建立后续可复用提示缓存的 Token。', calculation: '读取供应商缓存创建/写入字段。', source: '供应商暴露时的 Usage。', limit: '并非所有供应商都记录缓存写入。' },
  { term: '常驻层', aliases: 'resident system persistent', category: '上下文', definition: '无法从对话块重建、但持续进入模型的输入，例如隐藏指令或工具定义。', calculation: '供应商输入减去校准后的可见内容。', source: '基于真实 Usage 的校准估算。', limit: '拟合不足时会隐藏该数值，而不是给出伪精确结果。' },
  { term: '可见内容估算', aliases: 'visible reconstructed', category: '证据', definition: '日志中消息、工具、文件和摘要内容块的 Token 估算。', calculation: '内容块计数在各校准区间内缩放。', source: '本地文本与 tokenizer/启发式证据。', limit: '图片与 Schema 先验必须携带误差区间。' },
  { term: '校准 r²', aliases: 'r-squared 拟合度', category: '证据', definition: '当前区间内，可见内容对供应商输入量的解释程度。', calculation: '拟合 Token 缩放和常驻项后的决定系数。', source: '多次具有真实 Usage 的模型调用。', limit: '拟合度高只支持计量关系，不代表语义判断正确。' },
  { term: '置信度', aliases: 'exact inferred guessed', category: '证据', definition: '一项归因或发现被证据直接支持的程度。', calculation: 'exact 来自源记录，inferred 来自确定性规则，guessed 来自启发式或先验。', source: '适配器与治理规则。', limit: '置信度不是概率。' },
  { term: '上下文压缩', aliases: 'compaction summary', category: '压缩', definition: '先前上下文被缩减或摘要的可观测边界。', calculation: '对齐压缩前后 Frame，分类保留、摘要、截断、丢弃、新增或不可观测。', source: 'Agent 标记与内容块证据。', limit: '缺少摘要正文时，无法匹配的历史只能标记为不可观测。' },
  { term: 'SourceRef（来源引用）', aliases: 'pointer evidence', category: '证据', definition: '内容块回到本地源记录的结构化引用。', calculation: '由 source id、记录序号、JSON Pointer 或字节区间组成。', source: '适配器解析器。', limit: '它只指向证据；正文按需读取，不常驻内存。' },
  { term: 'Agent', aliases: 'harness 客户端 运行时', category: '身份', definition: '组装模型请求的客户端或运行时，例如 Codex、Trae。', calculation: '与模型供应商独立记录。', source: '适配器与来源身份。', limit: '同一个 Agent 可以使用多个供应商。' },
  { term: '模型供应商', aliases: 'provider vendor api', category: '身份', definition: '提供 API 或模型的厂商，例如 OpenAI、Anthropic、DeepSeek、Google。', calculation: '从请求或日志元数据读取。', source: '供应商或 Agent 记录。', limit: '不会仅根据 Agent 名称猜测供应商。' },
  { term: '工具 Schema', aliases: 'function MCP definition', category: '工具', definition: '模型可见的工具调用定义。', calculation: '完整请求中精确读取；仅有工具名时使用明确标注的先验估算。', source: '请求 tools 数组或 Agent 工具名单。', limit: '先验值不是精确 Usage。' },
  { term: '重复上下文', aliases: 'duplicate content 重复内容块', category: '治理', definition: '同一次模型调用中，同时存在多份独立记录但内容相同的上下文块。', calculation: '在每个 ContextFrame 内按内容指纹分组；保留一份，其余计为预计浪费。', source: '内容块哈希与 SourceRef 证据。', limit: '内容指纹相同属于推断证据；规则会忽略小体量重复和普通对话文本。' },
  { term: '已加载但未调用', aliases: 'idle tool unused schema 空闲工具', category: '治理', definition: '日志观测到工具 Schema 已加载，但整个会话没有对应工具调用。', calculation: '对已加载工具集合与已调用工具集合做精确差集。', source: 'Agent 工具名单与工具调用记录。', limit: '工具集合判断是精确的，Schema Token 成本仍可能来自先验。' },
  { term: 'ActionProposal（操作提案）', aliases: 'action preview 治理建议 操作预览', category: '治理', definition: '一份带证据的操作提案，说明可以修改什么、在哪里执行，以及需要哪项能力。', calculation: '根据一条 GovernanceFinding 和当前 Agent 能力矩阵确定性生成。', source: '治理规则与 AgentCapabilities。', limit: '提案不等于已经应用；界面必须明确展示可用状态。' },
  { term: '执行位置', aliases: 'execution target apply location 控制面', category: '治理', definition: '批准后的优化实际运行边界，例如 Agent 配置、工具 Hook 或请求代理。', calculation: '由稳定 action id 解析，和 Agent 厂商名称解耦。', source: 'Tokray 操作注册表。', limit: '历史日志不可变，永远不会作为优化执行位置。' },
  { term: 'Hook Bridge', aliases: 'agent hook runtime bridge action provider', category: '治理', definition: '让 Agent 原生 Hook 可以请求 Tokray 输出过滤或 RTK 命令改写的本地调度边界。', calculation: 'Tokray 注册 Agent 与 Provider 组合，只在该组合启用时分发。', source: 'Tokray Bridge 注册表与 Agent Hook/配置接口。', limit: '“已注册”只表示 Tokray 侧就绪，不证明厂商原生 Hook 已连接。' },
  { term: '原生请求治理器', aliases: 'Native Request Governor 模型请求 预算 工具白名单 请求代理', category: '治理', definition: 'Tokray 面向 OpenAI、Anthropic 兼容模型请求的厂商中立前置转换器。', calculation: '保持消息字段不变，压缩自然语言工具描述，移除完全重复定义，应用显式 allowlist，再检查估算输入预算。', source: '完整请求 JSON 与用户提供的治理选项。', limit: '估算范围是序列化请求内容，不是供应商 tokenizer 或账单 Usage；未连接 Hook/代理时只返回治理候选，不会自动拦截 Agent。' },
  { term: '原生输出过滤', aliases: 'tokray native tool output compression 内置治理', category: '治理', definition: 'Tokray 在工具返回后、进入模型请求前执行的确定性终端输出治理。', calculation: '清理 ANSI 与进度噪声、折叠重复，并按 Profile 保留诊断窗口和显式省略标记。', source: '原始工具输出、可选命令与退出码。', limit: 'bytes / 4 只估算工具输出体量，不等于供应商账单或已验证的模型输入节省。' },
  { term: '策略成熟度', aliases: 'available diagnose planned 可用 诊断 规划', category: '治理', definition: '一项内置治理策略当前真实实现到哪一层。', calculation: 'available 可执行转换；diagnose 只关联问题与证据；planned 尚无已交付诊断或转换。', source: 'Tokray 原生策略注册表。', limit: '成熟度表示能力状态，不是质量分或收益分。' },
  { term: '渐进式披露', aliases: 'progressive disclosure 按需检索 上下文选择', category: '治理', definition: '请求中只保留摘要或引用，任务需要时才读取完整内容。', calculation: '对比始终常驻的内容、后续引用位置和检索路径。', source: '内容块生命周期与 SourceRef。', limit: 'Tokray 当前将其标记为规划能力，不会主动改写上下文。' },
  { term: '记忆外化', aliases: 'memory externalization 长期驻留 文件 检索', category: '治理', definition: '把长期内容从每次请求中移到文件、记忆存储或按需引用。', calculation: '识别跨多次调用长期驻留但很少再次引用的大块内容。', source: '驻留 Frame 和最后引用证据。', limit: 'Tokray 当前只诊断候选，不会修改 Agent 记忆。' },
  { term: '稳定缓存前缀', aliases: 'stable cache prefix prompt cache 请求前缀', category: '治理', definition: '保持请求开头的静态指令、Schema 和顺序稳定，以提高供应商缓存复用。', calculation: '比较模型或请求结构边界前后的缓存读取与非缓存输入。', source: '供应商 Usage 和重建的调用边界。', limit: '缓存语义因供应商而异，诊断结果不直接证明因果。' },
  { term: '确定性工作流外置', aliases: 'deterministic workflow offload 编排 脚本', category: '治理', definition: '把可重复的机械步骤交给脚本或 API，只让模型承担语义判断。', calculation: '寻找输出和分支都可以明确规定的重复工具序列。', source: '工具序列与模型调用边界。', limit: '该能力仍在规划中，Tokray 不会演变为通用工作流平台。' },
  { term: 'ActionReceipt（操作凭证）', aliases: 'receipt rollback audit action log 回滚', category: '治理', definition: '一次显式批准的治理动作完成后写入的不可变本地记录。', calculation: '记录动作、执行位置、时间、脱敏变更、结果指标和回滚可用性。', source: 'Tokray Action Provider。', limit: 'Receipt 证明 Tokray 执行了本地动作，不代表后续模型质量已经改善。' },
  { term: 'RTK gain', aliases: 'rust token killer 输出缩减 bytes 4', category: '治理', definition: 'RTK 对 Bash 命令原始输出和压缩输出之间缩减量的统计。', calculation: 'RTK 使用 bytes / 4 估算原始与压缩输出，并报告两者差值。', source: 'rtk gain --all --format json。', limit: '它表示 Bash 输出缩减，不是已经验证的模型输入或账单节省。' },
  { term: 'RTK 重写预览', aliases: 'command rewrite hook preview 命令改写', category: '治理', definition: '只读检查 RTK 会如何改写一条 Shell 命令。', calculation: 'Tokray 将命令作为单独进程参数调用 rtk rewrite。', source: '官方 RTK 二进制。', limit: '预览不会执行原命令或改写后的命令。' },
  { term: 'RTK 输出对比', aliases: 'raw compact experiment bytes token 原始 压缩', category: '治理', definition: '用户显式批准后，将白名单内的低风险原命令和 RTK 改写命令各运行一次。', calculation: '比较退出码、耗时、输出字节、行数和 bytes / 4 估算。', source: '本地进程实际输出。', limit: '它会执行两条命令；输出缩减仍不等于已验证的模型输入或账单节省。' },
  { term: '不可观测', aliases: 'unobserved unknown missing', category: '证据', definition: '现有证据无法区分多个可能结果的状态。', calculation: '当至少两种结果仍成立时使用。', source: '缺失字段或不完整边界。', limit: '不可观测不会被当成零，也不会被擅自认定为丢弃。' },
];

export function GlossaryView() {
  const { locale } = useI18n();
  const [query, setQuery] = useState('');
  const terms = locale === 'zh-CN' ? zhTerms : enTerms;
  const copy = locale === 'zh-CN'
    ? { title: '术语库', subtitle: '定义、计算方式、证据来源与限制', search: '搜索术语、别名或定义', all: '全部', definition: '定义', calculation: '计算方式', source: '数据来源', limit: '限制', empty: '没有匹配的术语' }
    : { title: 'Glossary', subtitle: 'Definitions, calculations, evidence sources, and limits', search: 'Search terms, aliases, or definitions', all: 'All', definition: 'Definition', calculation: 'Calculation', source: 'Data source', limit: 'Limits', empty: 'No matching terms' };
  const [category, setCategory] = useState(copy.all);
  useEffect(() => setCategory(copy.all), [copy.all]);
  const categories = [copy.all, ...new Set(terms.map((term) => term.category))];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return terms.filter((term) => (category === copy.all || term.category === category) && (!needle || Object.values(term).join(' ').toLocaleLowerCase().includes(needle)));
  }, [category, copy.all, query, terms]);
  return (
    <section className="glossary-view">
      <header className="page-heading"><div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div><BookOpen size={20} /></header>
      <div className="glossary-toolbar">
        <label className="glossary-search"><Search size={15} /><span className="sr-only">{copy.search}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label>
        <div className="glossary-categories" aria-label={copy.title}>{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      </div>
      <div className="glossary-list">
        {filtered.map((term) => <article key={term.term}>
          <header><h3>{term.term}</h3><span>{term.category}</span></header>
          <dl>
            <div><dt>{copy.definition}</dt><dd>{term.definition}</dd></div>
            <div><dt>{copy.calculation}</dt><dd>{term.calculation}</dd></div>
            <div><dt>{copy.source}</dt><dd>{term.source}</dd></div>
            <div><dt>{copy.limit}</dt><dd>{term.limit}</dd></div>
          </dl>
        </article>)}
        {filtered.length === 0 && <div className="glossary-empty">{copy.empty}</div>}
      </div>
    </section>
  );
}
