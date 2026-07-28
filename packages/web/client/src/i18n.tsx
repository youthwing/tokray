import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Locale = 'en' | 'zh-CN';

const en = {
  local: 'local', all: 'All', filterAgents: 'Filter sessions by agent', searchSessions: 'Search sessions',
  sessions: 'Sessions', noMatchingSessions: 'No matching sessions', privacy: 'Logs stay on this machine',
  rawRequest: 'Raw request', allAgents: 'All agents', agent: 'Agent', provider: 'Provider', session: 'Session', loadMore: 'Load more',
  showingSessions: 'Showing {shown} of {total}', switchDark: 'Switch to dark theme', switchLight: 'Switch to light theme',
  switchChinese: '切换到中文', switchEnglish: 'Switch to English', refreshSessions: 'Refresh sessions',
  contextAnalysis: 'Context analysis', selectSession: 'Select a local agent session', calls: '{count} calls', finalTokens: '{tokens} final',
  readingData: 'Reading local session data...', analysisUnavailable: 'Analysis unavailable', tryAgain: 'Try again',
  noSupportedSessions: 'No supported sessions found', noSupportedSessionsDesc: 'Tokray scans all local Claude Code and Codex session directories.',
  contextOverTime: 'Context over time', compositionAcross: 'Composition normalized to provider input across {count} model calls',
  selectedCall: 'Selected call', inputShort: '{tokens} input', analysisViews: 'Analysis views', overview: 'Overview', conversation: 'Conversation', blocks: 'Blocks', tools: 'Tools', issues: 'Issues {count}',
  inputContext: 'Input context', inputContextDetail: 'call #{seq} · {source}', providerReported: 'provider reported', estimated: 'estimated',
  inputContextHelp: 'Total prompt tokens sent to the model for the selected call, including cached input where the provider reports it.',
  newThisCall: 'New this call', percentOfInput: '{percent}% of input', newThisCallHelp: 'Blocks that first appeared in the selected model call.',
  visibleEstimate: 'Visible estimate', aboveProvider: '{tokens} above provider total', reconstructedBlocks: '{count} reconstructed blocks',
  visibleEstimateHelp: 'Calibrated token estimate for reconstructed conversation blocks. Image and schema priors can make this exceed provider usage; the chart normalizes composition to the reported input total.',
  cacheReused: 'Cache reused', inputTokens: '{tokens} input tokens', cacheHelp: 'Provider-reported input tokens served from prompt cache for the selected call.',
  residentEstimate: 'Resident estimate', range: '{low}-{high} range', noErrorRange: 'no error range',
  residentHelp: 'Estimated system instructions and other persistent input not reconstructed as conversation blocks.',
  estimateExceeds: 'Estimate exceeds provider input by {tokens}.', chartNormalizes: 'The chart preserves category proportions but normalizes the stack to {tokens}.',
  reconstructed: '{tokens} reconstructed', reconstructedRemainder: 'from visible blocks. Resident content and provider accounting explain the remainder.',
  accountingQuality: 'Accounting quality', strategy: 'Strategy', calibrationFit: 'Calibration fit', observedCalls: 'Observed calls', tokenScale: 'Token scale',
  systemPrompt: 'System prompt', toolSchemas: 'Tool schemas', recorded: 'Recorded', inferred: 'Inferred', partialPrior: 'Partial / prior',
  qualityHigh: 'High', qualityMedium: 'Medium', qualityLow: 'Low', residentBreakdown: 'Resident breakdown', knownSchemaPriors: 'Known schema priors',
  systemUnobserved: 'System + unobserved', residentSuspects: 'Resident suspects', frame: 'Frame', input: 'Input', added: 'Added', model: 'Model',
  origin: 'Origin', source: 'Source', confidence: 'Confidence', age: 'Age', method: 'Method', tokens: 'Tokens', callAge: '{count} call', callsAge: '{count} calls',
  readingFrame: 'Reading frame content...', conversationUnavailable: 'Conversation unavailable', noConversation: 'No conversation content',
  noConversationDesc: 'This call contains only system or schema blocks.', contextTranscript: 'Context transcript', transcriptCount: '{shown} of {total} blocks in call #{seq}', sessionTranscriptCount: '{shown} of {total} blocks in the full session',
  currentCall: 'Current call', fullSession: 'Full session', conversationScope: 'Conversation scope', messages: 'Messages', toolActivity: 'Tool activity', allContent: 'All', conversationFilter: 'Conversation content filter', findContext: 'Find in context', searchContent: 'Search content',
  toolResult: 'Tool result', toolCall: 'Tool call', user: 'User', summary: 'Summary', assistant: 'Assistant', recordMeta: '{tokens} tokens · record {record}',
  noMatchingContent: 'No matching content', noMatchingContentDesc: 'Change the filter or search term.', tool: 'Tool', server: 'Server',
  toolCalls: 'Calls', toolInputs: 'Inputs', toolResults: 'Results', total: 'Total', builtIn: 'Built-in', noToolActivity: 'No tool activity',
  noToolActivityDesc: 'This session contains no matched tool calls.', noParserIssues: 'No parser issues', noParserIssuesDesc: 'Every record matched the adapter schema.', record: 'Record {record}',
  timelineResident: 'Resident', timelineSystem: 'System', timelineUser: 'User', timelineAssistant: 'Assistant', timelineToolResults: 'Tool results',
  timelineToolSchemas: 'Tool schemas', timelineSummary: 'Summary', timelineUnknown: 'Unknown', timelineUnattributed: 'Unattributed', timelineFrame: 'Call {seq}', timelineTotal: 'Total: {tokens}',
  coverageTitle: 'What is included?', coverageBody: 'Current call shows exactly the reconstructed context visible to that model call. Full session merges every reconstructable conversation block from the local log, including pre-compaction history and tail records.',
  sessionDiagnosis: 'Session diagnosis', sessionDiagnosisHelp: 'Rule-based findings derived from the same report evidence shown below. This is not an opaque score or an AI-generated summary.',
  diagnosisScope: 'Prioritized findings first; complete metrics and inspectable evidence remain below.', diagnosisCritical: '{count} issues need immediate attention', diagnosisAttention: '{count} issues are worth addressing', diagnosisHealthy: 'No material context issues detected', diagnosisNoEvidence: 'No diagnosis rule was triggered for this session.',
  governanceIssues: 'Needs attention', governanceOpportunities: 'Optimization opportunities', governanceSignals: 'Healthy signals',
  severityCritical: 'Critical', severityWarning: 'Attention', severityInfo: 'Observation', severityPositive: 'Efficient',
  findingContextPeakTitle: 'Context peaked at {tokens}', findingContextPeakDetail: 'Call #{seq} had the largest model-visible input in this session.',
  findingPersistentTitle: '“{source}” persisted for {count} calls', findingPersistentDetail: 'About {tokens} continued to occupy subsequent context.',
  findingToolTitle: '“{source}” accumulated {tokens}', findingToolDetail: '{count} calls made it the largest observed tool burden.',
  findingDuplicateTitle: 'Duplicate context can recover about {tokens}', findingDuplicateDetail: '{copies} identical “{source}” blocks coexist in call #{seq}; equality is supported by their content fingerprints.',
  findingIdleToolsTitle: '{count} loaded tools were never called', findingIdleToolsDetail: 'Their schemas account for about {tokens}; tool presence is exact while Token pricing remains a prior.', findingIdleToolsUnknownDetail: 'Loaded-versus-called evidence is exact; this adapter has no defensible Schema Token price.',
  findingCompactionTitle: 'Context compacted {count} times', findingCompactionDetail: 'The latest boundary reduced input by {percent}%; {tokens} has no observable destination.',
  findingCacheTitle: 'Cache reused {percent}% of input', findingCacheDetail: '{input} total input; {uncached} was not served from cache.',
  findingConfidenceTitle: '{count} calibration epochs have low confidence', findingConfidenceDetail: 'The first affected epoch starts at call #{seq}; resident estimates there are withheld.',
  findingParserTitle: '{count} records need parser attention', findingParserDetail: 'The adapter preserved a redacted anomaly instead of guessing at an unknown record.',
  viewCall: 'Inspect call', viewBlock: 'Inspect block', viewTool: 'Inspect tool', viewCompaction: 'Inspect compaction', viewUsage: 'Inspect usage', viewCalibration: 'Inspect calibration', viewIssues: 'Inspect issues',
  contextAuditor: 'context auditor', dataQuality: 'Quality', usage: 'Usage', compaction: 'Compaction {count}', selectedCallMetrics: 'Metrics for call {seq}',
  dataQualityHelp: 'Confidence in the selected call’s reconstructed accounting. Exact request captures rank highest; calibrated logs use the fit between visible blocks and provider usage.',
  confidenceHelp: 'How directly the value is supported: exact comes from the log, inferred follows deterministic evidence, and guessed uses a prior or heuristic.', ageHelp: 'The number of model calls for which this content block remained present in reconstructed context.', methodHelp: 'The tokenizer or estimation strategy used to produce this block’s Token count.',
  calibrationR2Help: 'R-squared measures how well reconstructed visible tokens explain provider-reported input within this epoch. Values closer to 1 indicate a stronger fit.', calibrationScaleHelp: 'Multiplier fitted between locally counted visible tokens and provider-reported input for this epoch.',
  insufficientConfidence: 'insufficient confidence · r² {r2}', calibrationSuppressed: 'Resident estimate withheld.', calibrationSuppressedDetail: 'This calibration epoch does not fit the observed usage well enough to support a precise resident-layer value.',
  calibrationEpochs: 'Calibration epochs', calibrationEpochsDesc: 'Independent fits split at compaction and model boundaries', largestContributors: 'Largest visible contributors', largestContributorsDesc: 'Highest token blocks in the selected call',
  usageSummary: 'Session usage summary', usageCalls: 'Calls', usageSources: '{count} usage sources', usageCallsHelp: 'Model calls with usable input accounting in this session.',
  usageInput: 'Input', usageCumulative: 'cumulative prompt volume', usageInputHelp: 'Sum of normalized model-visible input tokens across calls, including cached input.',
  usageCacheRead: 'Cache read', usageCacheRate: '{percent}% of input', usageCacheHelp: 'Provider-reported prompt tokens served from cache.',
  usageCacheWrite: 'Cache write', usageCacheWriteDetail: 'new cache population', usageCacheWriteHelp: 'Provider-reported prompt tokens written into a reusable cache.',
  usageUncached: 'Uncached input', usageInputAfterCache: 'input not served from cache', usageUncachedHelp: 'Normalized input minus provider-reported cache reads.',
  usageOutput: 'Output', usageReasoning: '{tokens} reasoning', usageOutputHelp: 'Provider-reported output tokens; reasoning output is shown separately when logged.',
  usageOverTime: 'Usage over time', usageOverTimeDesc: 'Provider usage per model call; output uses the right axis', usageByModel: 'Usage by model', usageByModelDesc: 'Cumulative provider-reported and normalized totals', usageProvenance: 'Usage provenance',
  usageProvenanceHelp: 'Where usage numbers came from. Provider API/log values are counted; estimated values remain context evidence and are excluded from usage totals.',
  noProviderUsage: 'No provider usage in this log', noProviderUsageDesc: 'Context estimates remain available, but Tokray does not present them as provider usage.',
  noCompactions: 'No compaction markers', noCompactionsDesc: 'This session contains no observed context-compaction boundary.', compactionEvents: 'Compaction events', compactionEventsDesc: '{count} observed boundaries', contextReduction: 'Context reduction', compactionDetail: 'Compaction detail',
  beforeCompaction: 'Before', beforeCompactionHelp: 'Provider-reported input context immediately before the compaction boundary.', afterCompaction: 'After', afterCompactionHelp: 'Provider-reported input context on the first call after compaction.',
  tokensReduced: '{tokens} fewer input tokens', contextReductionHelp: 'Relative change in provider-reported input context across the boundary.', fateSummarized: 'Summarized', fateSummarizedHelp: 'Blocks with identifiers observed in a logged summary.',
  fateUnobserved: 'Unobserved', fateUnobservedHelp: 'Blocks whose fate cannot be distinguished because the summary body is absent from the log.', summaryNotLogged: 'Summary body is not present in this log.', summaryNotLoggedDesc: 'Tokray reports unmatched blocks as unobserved instead of claiming they were dropped.',
  fateKept: 'Kept', fateTruncated: 'Truncated', fateDropped: 'Dropped', fateAdded: 'Added', fate: 'Fate', fateHelp: 'The evidence-supported outcome of a block across a compaction boundary.', tokenImpact: 'Token impact', tokenImpactHelp: 'Approximate number of pre-compaction Tokens associated with this fate.', evidence: 'Evidence', fateKeptDetail: 'Exact content hash matched after compaction.',
  fateKeptHelp: 'The same content was observed after compaction.', fateTruncatedHelp: 'A shorter matching form was observed after compaction.', fateDroppedHelp: 'Evidence shows the content did not survive and was not represented by the logged summary.', fateAddedHelp: 'The content first appeared after the compaction boundary.',
  fateCoverage: '{percent}% identifier coverage · {evidence}', fateTruncatedDetail: '{kept} retained in the matched block', fateUnobservedDetail: 'The marker contains no summary payload; dropped and summarized cannot be distinguished.', fateAddedDetail: 'Block first appears after compaction.',
  toolTokenAccountingHelp: 'Sum of locally counted tool-call inputs and tool-result content across the session. It is context burden, not a provider billing field.',
} as const;

type TranslationKey = keyof typeof en;

const zh: Record<TranslationKey, string> = {
  local: '本地', all: '全部', filterAgents: '按 Agent 筛选会话', searchSessions: '搜索会话', sessions: '会话', noMatchingSessions: '没有匹配的会话',
  privacy: '日志始终保留在本机', rawRequest: '原始请求', allAgents: '全部 Agent', agent: 'Agent', provider: '模型供应商', session: '会话', loadMore: '加载更多',
  showingSessions: '已显示 {shown} / {total}', switchDark: '切换到深色主题', switchLight: '切换到浅色主题', switchChinese: '切换到中文', switchEnglish: 'Switch to English',
  refreshSessions: '刷新会话', contextAnalysis: '上下文分析', selectSession: '选择一个本地 Agent 会话', calls: '{count} 次调用', finalTokens: '最终 {tokens}',
  readingData: '正在读取本地会话数据...', analysisUnavailable: '分析不可用', tryAgain: '重试', noSupportedSessions: '未找到支持的会话',
  noSupportedSessionsDesc: 'Tokray 会扫描本机全部 Claude Code 与 Codex 会话目录。', contextOverTime: '上下文时间线',
  compositionAcross: '按供应商输入量归一化，覆盖 {count} 次模型调用', selectedCall: '当前调用', inputShort: '输入 {tokens}', analysisViews: '分析视图', overview: '概览',
  conversation: '对话', blocks: '内容块', tools: '工具', issues: '问题 {count}', inputContext: '输入上下文', inputContextDetail: '调用 #{seq} · {source}',
  providerReported: '供应商上报', estimated: '估算', inputContextHelp: '选中调用发送给模型的提示词总量；若供应商提供缓存统计，则包含缓存输入。',
  newThisCall: '本次新增', percentOfInput: '占输入 {percent}%', newThisCallHelp: '第一次出现在当前模型调用中的内容块。', visibleEstimate: '可见内容估算',
  aboveProvider: '比供应商总量高 {tokens}', reconstructedBlocks: '已重建 {count} 个内容块', visibleEstimateHelp: '对重建出的对话内容进行校准后的 token 估算。图片和 schema 先验可能使它高于供应商用量；图表会按供应商总输入归一化。',
  cacheReused: '缓存复用', inputTokens: '{tokens} 输入 token', cacheHelp: '供应商上报的当前调用提示缓存命中量。', residentEstimate: '常驻层估算',
  range: '区间 {low}-{high}', noErrorRange: '无误差区间', residentHelp: '无法从对话重建的系统指令、工具定义及其他持久输入估算。',
  estimateExceeds: '估算比供应商输入高 {tokens}。', chartNormalizes: '图表保留分类比例，但将总堆叠归一到 {tokens}。', reconstructed: '已重建 {tokens}',
  reconstructedRemainder: '可见内容块；其余输入由常驻内容与供应商计量解释。', accountingQuality: '计量质量', strategy: '策略', calibrationFit: '校准拟合度',
  observedCalls: '观测调用数', tokenScale: 'Token 缩放', systemPrompt: '系统提示词', toolSchemas: '工具 Schema', recorded: '已记录', inferred: '推断',
  partialPrior: '部分记录 / 先验', qualityHigh: '高', qualityMedium: '中', qualityLow: '低', residentBreakdown: '常驻层构成', knownSchemaPriors: '已知 Schema 先验',
  systemUnobserved: '系统与未观测内容', residentSuspects: '疑似常驻项', frame: '帧', input: '输入', added: '新增', model: '模型', origin: '来源类型',
  source: '来源', confidence: '置信度', age: '驻留时长', method: '计量方法', tokens: 'Token', callAge: '{count} 次调用', callsAge: '{count} 次调用',
  readingFrame: '正在读取当前调用内容...', conversationUnavailable: '对话内容不可用', noConversation: '没有对话内容', noConversationDesc: '当前调用仅包含系统内容或工具 Schema。',
  contextTranscript: '上下文记录', transcriptCount: '调用 #{seq} 中显示 {shown} / {total} 个内容块', sessionTranscriptCount: '完整会话中显示 {shown} / {total} 个内容块', currentCall: '当前调用', fullSession: '完整会话', conversationScope: '对话范围', messages: '消息', toolActivity: '工具活动', allContent: '全部',
  conversationFilter: '对话内容筛选', findContext: '在上下文中查找', searchContent: '搜索内容', toolResult: '工具结果', toolCall: '工具调用', user: '用户', summary: '摘要',
  assistant: '助手', recordMeta: '{tokens} token · 记录 {record}', noMatchingContent: '没有匹配内容', noMatchingContentDesc: '请调整筛选条件或搜索词。', tool: '工具',
  server: '服务', toolCalls: '调用次数', toolInputs: '输入', toolResults: '结果', total: '总量', builtIn: '内置', noToolActivity: '没有工具活动',
  noToolActivityDesc: '当前会话中没有匹配的工具调用。', noParserIssues: '没有解析问题', noParserIssuesDesc: '所有记录均符合 adapter 已知结构。', record: '记录 {record}',
  timelineResident: '常驻层', timelineSystem: '系统', timelineUser: '用户', timelineAssistant: '助手', timelineToolResults: '工具结果', timelineToolSchemas: '工具定义',
  timelineSummary: '摘要', timelineUnknown: '未知', timelineUnattributed: '未归因', timelineFrame: '调用 {seq}', timelineTotal: '总计：{tokens}',
  coverageTitle: '当前展示范围', coverageBody: '“当前调用”仅显示该次模型调用实际可见的重建上下文；“完整会话”合并本地日志中所有可重建对话块，包括压缩前历史和尾部记录。',
  sessionDiagnosis: '会话诊断', sessionDiagnosisHelp: '根据下方同一份报告证据执行透明规则判断，不是模糊评分，也不是 AI 自动总结。',
  diagnosisScope: '先给出处理优先级；完整指标和可核对证据继续保留在下方。', diagnosisCritical: '发现 {count} 个需要立即关注的问题', diagnosisAttention: '发现 {count} 个值得处理的问题', diagnosisHealthy: '未发现明显的上下文问题', diagnosisNoEvidence: '当前会话没有触发任何诊断规则。',
  governanceIssues: '需要处理', governanceOpportunities: '优化机会', governanceSignals: '正常信号',
  severityCritical: '严重', severityWarning: '需关注', severityInfo: '观察项', severityPositive: '表现良好',
  findingContextPeakTitle: '上下文峰值达到 {tokens}', findingContextPeakDetail: '调用 #{seq} 是本会话模型可见输入量最高的一次。',
  findingPersistentTitle: '“{source}”已驻留 {count} 次调用', findingPersistentDetail: '约 {tokens} 持续占用后续上下文。',
  findingToolTitle: '“{source}”累计产生 {tokens}', findingToolDetail: '共调用 {count} 次，是当前观测到的最大工具负担。',
  findingDuplicateTitle: '重复上下文预计可回收 {tokens}', findingDuplicateDetail: '调用 #{seq} 中同时存在 {copies} 份相同的“{source}”内容；内容指纹为该判断提供证据。',
  findingIdleToolsTitle: '{count} 个已加载工具从未调用', findingIdleToolsDetail: '这些 Schema 约占 {tokens}；工具集合判断是精确的，Token 定价仍为先验。', findingIdleToolsUnknownDetail: '已加载与已调用集合的判断是精确的；当前适配器没有可信的 Schema Token 定价。',
  findingCompactionTitle: '发生 {count} 次上下文压缩', findingCompactionDetail: '最近一次输入减少 {percent}%；其中 {tokens} 去向不可观测。',
  findingCacheTitle: '缓存复用率 {percent}%', findingCacheDetail: '累计输入 {input}，其中 {uncached} 未由缓存提供。',
  findingConfidenceTitle: '{count} 个校准区间置信度较低', findingConfidenceDetail: '首个受影响区间从调用 #{seq} 开始；该区间不会展示常驻层精确估算。',
  findingParserTitle: '{count} 条记录需要解析器关注', findingParserDetail: '适配器保留了脱敏异常，没有对未知结构进行猜测。',
  viewCall: '查看调用', viewBlock: '查看内容块', viewTool: '查看工具', viewCompaction: '查看压缩', viewUsage: '查看用量', viewCalibration: '查看校准', viewIssues: '查看问题',
  contextAuditor: '上下文审计', dataQuality: '质量', usage: '用量', compaction: '压缩 {count}', selectedCallMetrics: '调用 {seq} 的指标',
  dataQualityHelp: '当前调用重建计量的可信程度。完整请求最高；日志校准模式根据可见内容与供应商用量的拟合程度判断。',
  confidenceHelp: '数值的证据强度：exact 来自日志直接记录，inferred 来自确定性推断，guessed 使用先验或启发式估算。', ageHelp: '该内容块在重建上下文中持续存在的模型调用次数。', methodHelp: '生成该内容块 Token 数量时使用的分词器或估算策略。',
  calibrationR2Help: '决定系数 r² 表示当前区间内，可见内容 Token 对供应商输入量的解释程度；越接近 1，拟合越可靠。', calibrationScaleHelp: '当前区间中，本地可见 Token 计数与供应商上报输入之间拟合出的缩放倍数。',
  insufficientConfidence: '置信度不足 · r² {r2}', calibrationSuppressed: '已隐藏常驻层估算。', calibrationSuppressedDetail: '当前校准区间与真实用量拟合不足，不提供看似精确的常驻层数值。',
  calibrationEpochs: '校准区间', calibrationEpochsDesc: '在压缩与模型切换边界独立拟合', largestContributors: '主要可见占用', largestContributorsDesc: '当前调用中 Token 最高的内容块',
  usageSummary: '会话用量汇总', usageCalls: '调用', usageSources: '{count} 类用量来源', usageCallsHelp: '当前会话中具备可用输入计量的模型调用数。',
  usageInput: '输入', usageCumulative: '累计提示词用量', usageInputHelp: '所有调用的标准化模型可见输入总和，包含缓存输入。',
  usageCacheRead: '缓存读取', usageCacheRate: '占输入 {percent}%', usageCacheHelp: '供应商上报的提示缓存命中 Token。',
  usageCacheWrite: '缓存写入', usageCacheWriteDetail: '新写入缓存', usageCacheWriteHelp: '供应商上报的可复用提示缓存写入 Token。',
  usageUncached: '非缓存输入', usageInputAfterCache: '未由缓存提供的输入', usageUncachedHelp: '标准化输入减去供应商上报的缓存读取量。',
  usageOutput: '输出', usageReasoning: '推理 {tokens}', usageOutputHelp: '供应商上报的输出 Token；日志提供时单独显示推理输出。',
  usageOverTime: '用量时序', usageOverTimeDesc: '逐次模型调用的供应商用量，输出使用右侧坐标轴', usageByModel: '按模型统计', usageByModelDesc: '累计的供应商上报与标准化用量', usageProvenance: '用量来源',
  usageProvenanceHelp: '用量数字的证据来源。只汇总供应商 API 或日志中的真实值；估算值仍作为上下文证据展示，但不计入 Usage。',
  noProviderUsage: '日志没有供应商用量', noProviderUsageDesc: '上下文估算仍可使用，但 Tokray 不会把估算值展示为供应商用量。',
  noCompactions: '没有压缩标记', noCompactionsDesc: '当前会话未发现上下文压缩边界。', compactionEvents: '压缩事件', compactionEventsDesc: '发现 {count} 个边界', contextReduction: '上下文缩减', compactionDetail: '压缩明细',
  beforeCompaction: '压缩前', beforeCompactionHelp: '压缩边界前一次调用的供应商上报输入上下文。', afterCompaction: '压缩后', afterCompactionHelp: '压缩后首次调用的供应商上报输入上下文。',
  tokensReduced: '输入减少 {tokens}', contextReductionHelp: '压缩边界前后供应商上报输入上下文的相对变化。', fateSummarized: '已摘要', fateSummarizedHelp: '日志摘要中重新出现关键标识符的内容块。',
  fateUnobserved: '不可观测', fateUnobservedHelp: '日志缺少摘要正文，无法区分被删除或被摘要的内容块。', summaryNotLogged: '当前日志没有记录摘要正文。', summaryNotLoggedDesc: 'Tokray 将未匹配内容标记为不可观测，不会声称它们已被删除。',
  fateKept: '保留', fateTruncated: '截断', fateDropped: '丢弃', fateAdded: '新增', fate: '状态', fateHelp: '内容块跨越压缩边界后，有证据支持的最终状态。', tokenImpact: 'Token 影响', tokenImpactHelp: '与该状态关联的压缩前 Token 近似数量。', evidence: '证据', fateKeptDetail: '压缩后匹配到完全相同的内容哈希。',
  fateKeptHelp: '压缩后仍观测到相同内容。', fateTruncatedHelp: '压缩后观测到较短但可匹配的内容。', fateDroppedHelp: '证据表明内容未保留，且未被已记录摘要表达。', fateAddedHelp: '内容首次出现在压缩边界之后。',
  fateCoverage: '标识符覆盖 {percent}% · {evidence}', fateTruncatedDetail: '匹配内容中保留 {kept}', fateUnobservedDetail: '标记中没有摘要正文，无法区分丢弃与摘要。', fateAddedDetail: '内容块首次出现在压缩后。',
  toolTokenAccountingHelp: '会话中工具调用入参与工具返回内容的本地 Token 计数之和，表示上下文负担，不是供应商计费字段。',
};

const resources: Record<Locale, Record<TranslationKey, string>> = { en, 'zh-CN': zh };

export function translate(locale: Locale, key: TranslationKey, values: Record<string, string | number> = {}): string {
  return resources[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

function initialLocale(): Locale {
  const stored = window.localStorage.getItem('tokray-locale') ?? window.localStorage.getItem('ctxray-locale');
  if (stored === 'en' || stored === 'zh-CN') return stored;
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem('tokray-locale', locale);
    window.localStorage.removeItem('ctxray-locale');
  }, [locale]);
  const t = useCallback((key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within I18nProvider');
  return value;
}
