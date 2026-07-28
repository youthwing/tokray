import type { AnalysisFrame, AnalysisReport, SessionFinding } from '@tokray/node';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertOctagon, AlertTriangle, ArrowRight, Bot, CheckCircle2, Database, Gauge, Info,
  MessageSquareText, Search, TerminalSquare, UserRound, Wrench,
} from 'lucide-react';
import { api } from './api';
import { fmtTokens } from './format';
import { HelpTip } from './HelpTip';
import { UsageTimeline } from './Timeline';
import { useI18n } from './i18n';

function Metric({ label, value, detail, help, tone }: { label: string; value: string; detail: string; help: string; tone?: string | undefined }) {
  return (
    <div className={`metric ${tone ? `metric-${tone}` : ''}`}>
      <span>{label}<HelpTip content={help} /></span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function qualityKey(frame: AnalysisFrame, report: AnalysisReport): 'high' | 'medium' | 'low' {
  if (report.capabilities.accounting === 'exact-request') return 'high';
  if (frame.calibration.r2 >= 0.9) return 'high';
  if (frame.calibration.r2 >= 0.7) return 'medium';
  return 'low';
}

export function DiagnosisView({
  report,
  onNavigate,
}: {
  report: AnalysisReport;
  onNavigate: (finding: SessionFinding) => void;
}) {
  const { t } = useI18n();
  const { diagnosis } = report;
  const findingCopy = (finding: SessionFinding) => {
    switch (finding.kind) {
      case 'context-peak': return {
        title: t('findingContextPeakTitle', { tokens: fmtTokens(finding.tokens) }),
        detail: t('findingContextPeakDetail', { seq: finding.frameSeq }),
        action: t('viewCall'),
      };
      case 'persistent-block': return {
        title: t('findingPersistentTitle', { source: finding.source, count: finding.ageFrames }),
        detail: t('findingPersistentDetail', { tokens: fmtTokens(finding.tokens) }),
        action: t('viewBlock'),
      };
      case 'tool-overhead': return {
        title: t('findingToolTitle', { source: finding.source, tokens: fmtTokens(finding.tokens) }),
        detail: t('findingToolDetail', { count: finding.calls }),
        action: t('viewTool'),
      };
      case 'duplicate-content': return {
        title: t('findingDuplicateTitle', { tokens: fmtTokens(finding.tokens) }),
        detail: t('findingDuplicateDetail', { copies: finding.copies, source: finding.source, seq: finding.frameSeq }),
        action: t('viewBlock'),
      };
      case 'idle-tools': return {
        title: t('findingIdleToolsTitle', { count: finding.count }),
        detail: finding.tokens > 0
          ? t('findingIdleToolsDetail', { tokens: fmtTokens(finding.tokens) })
          : t('findingIdleToolsUnknownDetail'),
        action: t('viewTool'),
      };
      case 'compaction': return {
        title: t('findingCompactionTitle', { count: finding.count }),
        detail: t('findingCompactionDetail', { percent: Math.round(finding.reduction * 100), tokens: fmtTokens(finding.unobservedTokens) }),
        action: t('viewCompaction'),
      };
      case 'cache-efficiency': return {
        title: t('findingCacheTitle', { percent: Math.round(finding.percentage * 100) }),
        detail: t('findingCacheDetail', { input: fmtTokens(finding.input), uncached: fmtTokens(finding.uncachedInput) }),
        action: t('viewUsage'),
      };
      case 'low-confidence': return {
        title: t('findingConfidenceTitle', { count: finding.count }),
        detail: t('findingConfidenceDetail', { seq: finding.frameSeq }),
        action: t('viewCalibration'),
      };
      case 'parser-issues': return {
        title: t('findingParserTitle', { count: finding.count }),
        detail: t('findingParserDetail'),
        action: t('viewIssues'),
      };
    }
  };
  const verdict = diagnosis.verdict === 'critical'
    ? t('diagnosisCritical', { count: diagnosis.issueCount })
    : diagnosis.verdict === 'attention'
      ? t('diagnosisAttention', { count: diagnosis.issueCount })
      : t('diagnosisHealthy');
  const groups = [
    {
      id: 'issues',
      label: t('governanceIssues'),
      findings: diagnosis.findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'warning'),
    },
    {
      id: 'opportunities',
      label: t('governanceOpportunities'),
      findings: diagnosis.findings.filter((finding) => finding.severity === 'info'),
    },
    {
      id: 'signals',
      label: t('governanceSignals'),
      findings: diagnosis.findings.filter((finding) => finding.severity === 'positive'),
    },
  ].filter((group) => group.findings.length > 0);

  return (
    <section className={`diagnosis-band diagnosis-${diagnosis.verdict}`} aria-labelledby="diagnosis-heading">
      <div className="diagnosis-heading">
        <div>
          <h2 id="diagnosis-heading">{t('sessionDiagnosis')}<HelpTip content={t('sessionDiagnosisHelp')} /></h2>
          <p>{t('diagnosisScope')}</p>
        </div>
        <strong className="diagnosis-verdict">{verdict}</strong>
      </div>
      <div className="finding-list">
        {groups.map((group) => <section className="finding-group" key={group.id} aria-labelledby={`finding-group-${group.id}`}>
          <div className="finding-group-heading"><span id={`finding-group-${group.id}`}>{group.label}</span><strong>{group.findings.length}</strong></div>
          {group.findings.map((finding, index) => {
            const copy = findingCopy(finding);
            const Icon = finding.severity === 'critical'
              ? AlertOctagon
              : finding.severity === 'warning'
                ? AlertTriangle
                : finding.severity === 'positive'
                  ? CheckCircle2
                  : Info;
            return (
              <article key={`${finding.kind}-${index}`} className={`finding-row finding-${finding.severity}`}>
                <Icon size={17} aria-hidden="true" />
                <div className="finding-copy">
                  <div><strong>{copy.title}</strong><span>{t(`severity${finding.severity[0]!.toUpperCase()}${finding.severity.slice(1)}` as 'severityInfo')}</span></div>
                  <p>{copy.detail}</p>
                </div>
                <button type="button" className="finding-action" onClick={() => onNavigate(finding)}>{copy.action}<ArrowRight size={14} /></button>
              </article>
            );
          })}
        </section>)}
        {diagnosis.findings.length === 0 && <div className="finding-empty"><CheckCircle2 size={17} /><span>{t('diagnosisNoEvidence')}</span></div>}
      </div>
    </section>
  );
}

export function Overview({ report, frame }: { report: AnalysisReport; frame: AnalysisFrame }) {
  const { t } = useI18n();
  const cache = frame.totals.cacheRead ?? 0;
  const cachePct = frame.totals.input ? Math.round((cache / frame.totals.input) * 100) : 0;
  const quality = qualityKey(frame, report);
  const calibrationReliable = quality !== 'low';
  const resident = calibrationReliable ? Math.min(frame.calibration.resident.value, frame.totals.input) : 0;
  const known = Object.values(frame.kinds).reduce((sum, value) => sum + value, 0);
  const overshoot = Math.max(0, known + resident - frame.totals.input);
  const selectedSegment = report.calibrationSegments.find((segment) => frame.seq >= segment.fromSeq && frame.seq <= segment.toSeq);
  const contributors = [...frame.blocks].sort((left, right) => right.tokens.value - left.tokens.value).slice(0, 6);
  return (
    <div className="overview-view">
      <section className="metric-strip" aria-label={t('selectedCallMetrics', { seq: frame.seq })}>
        <Metric label={t('inputContext')} value={fmtTokens(frame.totals.input)} detail={t('inputContextDetail', { seq: frame.seq, source: report.exactTotals ? t('providerReported') : t('estimated') })} help={t('inputContextHelp')} />
        <Metric label={t('newThisCall')} value={fmtTokens(frame.delta.addedTokens)} detail={t('percentOfInput', { percent: Math.round((frame.delta.addedTokens / Math.max(1, frame.totals.input)) * 100) })} help={t('newThisCallHelp')} />
        <Metric label={t('visibleEstimate')} value={fmtTokens(known)} detail={overshoot > 0 ? t('aboveProvider', { tokens: fmtTokens(overshoot) }) : t('reconstructedBlocks', { count: frame.blocks.length })} help={t('visibleEstimateHelp')} tone={overshoot > 0 ? 'warning' : undefined} />
        <Metric label={t('cacheReused')} value={`${cachePct}%`} detail={t('inputTokens', { tokens: fmtTokens(cache) })} help={t('cacheHelp')} />
        <Metric label={t('residentEstimate')} value={calibrationReliable ? fmtTokens(resident) : '—'} detail={calibrationReliable && frame.calibration.resident.errorBand ? t('range', { low: fmtTokens(frame.calibration.resident.errorBand[0]), high: fmtTokens(frame.calibration.resident.errorBand[1]) }) : t('insufficientConfidence', { r2: frame.calibration.r2.toFixed(3) })} help={t('residentHelp')} tone={calibrationReliable ? undefined : 'danger'} />
      </section>

      <div className={`measurement-note ${overshoot > 0 ? 'warning' : quality === 'low' ? 'danger' : ''}`}>
        <Info size={14} />
        <span>{quality === 'low'
          ? <><strong>{t('calibrationSuppressed')}</strong> {t('calibrationSuppressedDetail')}</>
          : overshoot > 0
            ? <><strong>{t('estimateExceeds', { tokens: fmtTokens(overshoot) })}</strong> {t('chartNormalizes', { tokens: fmtTokens(frame.totals.input) })}</>
            : <><strong>{t('reconstructed', { tokens: fmtTokens(known) })}</strong> {t('reconstructedRemainder')}</>}</span>
      </div>

      <div className="audit-grid">
        <section className="audit-section calibration-section" id="calibration-evidence">
          <div className="section-heading"><Gauge size={16} /><div><h3>{t('calibrationEpochs')}</h3><p>{t('calibrationEpochsDesc')}</p></div></div>
          <div className="epoch-list">
            {report.calibrationSegments.map((segment) => {
              const active = segment === selectedSegment;
              const segmentQuality = report.capabilities.accounting === 'exact-request' || segment.calibration.r2 >= 0.9 ? 'high' : segment.calibration.r2 >= 0.7 ? 'medium' : 'low';
              return (
                <div key={`${segment.fromSeq}-${segment.toSeq}`} className={`epoch-row ${active ? 'active' : ''}`}>
                  <span className="epoch-range">#{segment.fromSeq}–{segment.toSeq}</span>
                  <span className="epoch-model" title={segment.model}>{segment.model}</span>
                  <span className={`quality quality-${segmentQuality}`}>{t(segmentQuality === 'high' ? 'qualityHigh' : segmentQuality === 'medium' ? 'qualityMedium' : 'qualityLow')}<HelpTip content={t('confidenceHelp')} /></span>
                  <span className="mono">r² {segment.calibration.r2.toFixed(3)}<HelpTip content={t('calibrationR2Help')} /></span>
                  <span className="mono">×{segment.calibration.scale.toFixed(2)}<HelpTip content={t('calibrationScaleHelp')} /></span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="audit-section">
          <div className="section-heading"><Database size={16} /><div><h3>{t('largestContributors')}</h3><p>{t('largestContributorsDesc')}</p></div></div>
          <div className="contributor-list">
            {contributors.map((block) => (
              <div key={block.id} className="contributor-row">
                <span className={`origin-dot origin-${block.attribution.kind}`} />
                <span><strong>{block.attribution.source ?? block.attribution.kind}</strong><small>{block.attribution.confidence}<HelpTip content={t('confidenceHelp')} /> · {block.tokens.method}<HelpTip content={t('methodHelp')} /></small></span>
                <strong className="mono">{fmtTokens(block.tokens.value)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function UsageView({ report, theme }: { report: AnalysisReport; theme: 'light' | 'dark' }) {
  const { t } = useI18n();
  const { totals } = report.usage;
  const usageFrames = report.frames.filter((frame) => frame.providerUsage.source !== 'estimated');
  return (
    <div className="usage-view">
      <section className="metric-strip usage-metrics" aria-label={t('usageSummary')}>
        <Metric label={t('usageCalls')} value={String(totals.calls)} detail={t('usageSources', { count: report.usage.sources.length })} help={t('usageCallsHelp')} />
        <Metric label={t('usageInput')} value={fmtTokens(totals.input)} detail={t('usageCumulative')} help={t('usageInputHelp')} />
        <Metric label={t('usageCacheRead')} value={fmtTokens(totals.cacheRead)} detail={t('usageCacheRate', { percent: Math.round(report.usage.cacheHitRate * 100) })} help={t('usageCacheHelp')} />
        <Metric label={t('usageCacheWrite')} value={fmtTokens(totals.cacheWrite)} detail={t('usageCacheWriteDetail')} help={t('usageCacheWriteHelp')} />
        <Metric label={t('usageUncached')} value={fmtTokens(totals.uncachedInput)} detail={t('usageInputAfterCache')} help={t('usageUncachedHelp')} />
        <Metric label={t('usageOutput')} value={fmtTokens(totals.output)} detail={t('usageReasoning', { tokens: fmtTokens(totals.reasoningOutput) })} help={t('usageOutputHelp')} />
      </section>
      {usageFrames.length === 0 ? <div className="empty-state page-empty"><Database size={22} /><strong>{t('noProviderUsage')}</strong><span>{t('noProviderUsageDesc')}</span></div> : <>
      <section className="chart-section">
        <div className="section-heading"><Activity size={16} /><div><h3>{t('usageOverTime')}</h3><p>{t('usageOverTimeDesc')}</p></div></div>
        <UsageTimeline frames={usageFrames} theme={theme} />
      </section>
      <section className="usage-table-section">
        <div className="section-heading"><Database size={16} /><div><h3>{t('usageByModel')}</h3><p>{t('usageByModelDesc')}</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('provider')}</th><th>{t('model')}</th><th className="number">{t('usageCalls')}</th><th className="number">{t('usageInput')}</th><th className="number">{t('usageCacheRead')}</th><th className="number">{t('usageCacheWrite')}</th><th className="number">{t('usageOutput')}</th></tr></thead>
            <tbody>{report.usage.byModel.map((model) => (
              <tr key={`${model.provider}/${model.model}`}><td>{model.provider}</td><td className="mono">{model.model}</td><td className="number mono">{model.calls}</td><td className="number mono">{fmtTokens(model.input)}</td><td className="number mono">{fmtTokens(model.cacheRead)}</td><td className="number mono">{fmtTokens(model.cacheWrite)}</td><td className="number mono">{fmtTokens(model.output)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="provenance-line"><span>{t('usageProvenance')}<HelpTip content={t('usageProvenanceHelp')} /></span>{report.usage.sources.map((source) => <span key={source.source}><strong>{source.source}</strong> {source.calls}</span>)}</div>
      </section>
      </>}
    </div>
  );
}

export function CompactionView({ report }: { report: AnalysisReport }) {
  const { t } = useI18n();
  const [selectedAfter, setSelectedAfter] = useState(report.compactions.at(-1)?.after);
  const [limit, setLimit] = useState(120);
  if (report.compactions.length === 0) return <div className="empty-state page-empty"><Database size={22} /><strong>{t('noCompactions')}</strong><span>{t('noCompactionsDesc')}</span></div>;
  const event = report.compactions.find((item) => item.after === selectedAfter) ?? report.compactions.at(-1)!;
  const beforeFrame = report.frames.find((frame) => frame.seq === event.before);
  const afterFrame = report.frames.find((frame) => frame.seq === event.after);
  const before = new Map(beforeFrame?.blocks.map((block) => [block.id, block]));
  const after = new Map(afterFrame?.blocks.map((block) => [block.id, block]));
  const count = (kind: string) => event.fates.filter((fate) => fate.kind === kind).length;
  const rows = event.fates.slice(0, limit);
  const fateHelp = {
    kept: t('fateKeptHelp'),
    summarized: t('fateSummarizedHelp'),
    truncated: t('fateTruncatedHelp'),
    dropped: t('fateDroppedHelp'),
    unobserved: t('fateUnobservedHelp'),
    added: t('fateAddedHelp'),
  } as const;
  const blockName = (id: AnalysisFrame['blocks'][number]['id'], side: 'before' | 'after') => {
    const block = (side === 'before' ? before : after).get(id);
    return block ? block.attribution.source ?? block.attribution.kind : id;
  };
  const rowData = (fate: typeof event.fates[number]) => {
    if (fate.kind === 'kept') return { source: blockName(fate.from, 'before'), tokens: before.get(fate.from)?.tokens.value ?? 0, detail: t('fateKeptDetail') };
    if (fate.kind === 'summarized') return { source: fate.from.slice(0, 3).map((id) => blockName(id, 'before')).join(', '), tokens: fate.from.reduce((sum, id) => sum + (before.get(id)?.tokens.value ?? 0), 0), detail: t('fateCoverage', { percent: Math.round(fate.coverage * 100), evidence: fate.evidence.join(', ') || '—' }) };
    if (fate.kind === 'truncated') return { source: blockName(fate.from, 'before'), tokens: fate.lostTokens, detail: t('fateTruncatedDetail', { kept: fmtTokens(fate.keptTokens) }) };
    if (fate.kind === 'dropped') return { source: blockName(fate.from, 'before'), tokens: fate.lostTokens, detail: fate.why };
    if (fate.kind === 'unobserved') return { source: blockName(fate.from, 'before'), tokens: fate.tokens, detail: t('fateUnobservedDetail') };
    return { source: blockName(fate.to, 'after'), tokens: after.get(fate.to)?.tokens.value ?? 0, detail: t('fateAddedDetail') };
  };
  return (
    <div className="compaction-view">
      <aside className="compaction-list">
        <div className="section-heading"><Database size={16} /><div><h3>{t('compactionEvents')}</h3><p>{t('compactionEventsDesc', { count: report.compactions.length })}</p></div></div>
        {report.compactions.map((item) => (
          <button key={item.after} className={item.after === event.after ? 'active' : ''} onClick={() => { setSelectedAfter(item.after); setLimit(120); }}>
            <span>#{item.before} → #{item.after}</span>
            <strong>{Math.round((1 - item.stats.compressionRatio) * 100)}%</strong>
            <small>{t('contextReduction')}</small>
          </button>
        ))}
      </aside>
      <div className="compaction-detail">
        <section className="metric-strip compaction-metrics" aria-label={t('compactionDetail')}>
          <Metric label={t('beforeCompaction')} value={fmtTokens(event.stats.beforeTokens)} detail={`#${event.before}`} help={t('beforeCompactionHelp')} />
          <Metric label={t('afterCompaction')} value={fmtTokens(event.stats.afterTokens)} detail={`#${event.after}`} help={t('afterCompactionHelp')} />
          <Metric label={t('contextReduction')} value={`${Math.round((1 - event.stats.compressionRatio) * 100)}%`} detail={t('tokensReduced', { tokens: fmtTokens(Math.max(0, event.stats.beforeTokens - event.stats.afterTokens)) })} help={t('contextReductionHelp')} />
          <Metric label={t('fateSummarized')} value={String(count('summarized'))} detail={fmtTokens(event.stats.summarizedTokens)} help={t('fateSummarizedHelp')} />
          <Metric label={t('fateUnobserved')} value={String(count('unobserved'))} detail={fmtTokens(event.stats.unobservedTokens)} help={t('fateUnobservedHelp')} tone={event.stats.unobservedTokens > 0 ? 'warning' : undefined} />
        </section>
        {event.stats.unobservedTokens > 0 && <div className="measurement-note warning"><AlertTriangle size={14} /><span><strong>{t('summaryNotLogged')}</strong> {t('summaryNotLoggedDesc')}</span></div>}
        <div className="fate-legend">
          {(['kept', 'summarized', 'truncated', 'dropped', 'unobserved', 'added'] as const).map((kind) => <span key={kind} className={`fate fate-${kind}`}>{t(`fate${kind[0]!.toUpperCase()}${kind.slice(1)}` as 'fateKept')} <strong>{count(kind)}</strong><HelpTip content={fateHelp[kind]} /></span>)}
        </div>
        <div className="table-wrap fate-table">
          <table><thead><tr><th>{t('fate')}<HelpTip content={t('fateHelp')} /></th><th>{t('source')}</th><th className="number">{t('tokenImpact')}<HelpTip content={t('tokenImpactHelp')} /></th><th>{t('evidence')}</th></tr></thead>
            <tbody>{rows.map((fate, index) => { const data = rowData(fate); return <tr key={`${fate.kind}-${index}`}><td><span className={`fate fate-${fate.kind}`}>{t(`fate${fate.kind[0]!.toUpperCase()}${fate.kind.slice(1)}` as 'fateKept')}</span></td><td className="source-cell" title={data.source}>{data.source}</td><td className="number mono">{fmtTokens(data.tokens)}</td><td className="evidence-cell" title={data.detail}>{data.detail}</td></tr>; })}</tbody>
          </table>
        </div>
        {rows.length < event.fates.length && <button className="load-more compact-load" onClick={() => setLimit((value) => value + 120)}>{t('loadMore')}<span>{event.fates.length - rows.length}</span></button>}
      </div>
    </div>
  );
}

export function FrameInspector({ frame }: { frame: AnalysisFrame }) {
  const { t } = useI18n();
  const usageById = new Map(frame.usage.map((usage) => [String(usage.blockId), usage]));
  return <div className="frame-view"><div className="frame-summary"><div><span>{t('frame')}</span><strong>#{frame.seq}</strong></div><div><span>{t('input')}</span><strong>{fmtTokens(frame.totals.input)}</strong></div><div><span>{t('added')}</span><strong>+{fmtTokens(frame.delta.addedTokens)}</strong></div><div><span>{t('model')}</span><strong className="model-value">{frame.model.model}</strong></div></div><div className="table-wrap"><table><thead><tr><th>{t('origin')}</th><th>{t('source')}</th><th>{t('confidence')}<HelpTip content={t('confidenceHelp')} /></th><th>{t('age')}<HelpTip content={t('ageHelp')} /></th><th>{t('method')}<HelpTip content={t('methodHelp')} /></th><th className="number">{t('tokens')}</th></tr></thead><tbody>{frame.blocks.map((block) => { const usage = usageById.get(block.id); return <tr key={block.id}><td><span className={`origin-dot origin-${block.attribution.kind}`} />{block.attribution.kind}</td><td className="source-cell" title={block.attribution.source}>{block.attribution.source ?? '—'}</td><td><span className={`confidence confidence-${block.attribution.confidence}`}>{block.attribution.confidence}</span></td><td>{usage ? t(usage.ageFrames === 1 ? 'callAge' : 'callsAge', { count: usage.ageFrames }) : '—'}</td><td>{block.tokens.method}</td><td className="number mono">{fmtTokens(block.tokens.value)}</td></tr>; })}</tbody></table></div></div>;
}

export function ConversationView({ sessionId, frame }: { sessionId: string; frame: AnalysisFrame }) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'call' | 'session'>('call');
  const [filter, setFilter] = useState<'messages' | 'tools' | 'all'>('messages');
  const [search, setSearch] = useState('');
  const [entryLimit, setEntryLimit] = useState(150);
  const query = useQuery({ queryKey: ['conversation', sessionId, scope, scope === 'call' ? frame.seq : 'all'], queryFn: () => scope === 'call' ? api.conversation(sessionId, frame.seq) : api.sessionConversation(sessionId) });
  const entries = query.data ?? [];
  const visible = useMemo(() => { const needle = search.trim().toLocaleLowerCase(); return entries.filter((entry) => { const isTool = entry.kind === 'tool_result' || (entry.kind === 'assistant' && Boolean(entry.source)); if (filter === 'messages' && isTool) return false; if (filter === 'tools' && !isTool) return false; return !needle || `${entry.content} ${entry.source ?? ''} ${entry.kind}`.toLocaleLowerCase().includes(needle); }); }, [entries, filter, search]);
  const displayed = visible.slice(0, entryLimit);
  const changeScope = (value: 'call' | 'session') => { setScope(value); setEntryLimit(150); };
  if (query.isLoading) return <div className="conversation-loading">{t('readingFrame')}</div>;
  if (query.error) return <div className="error-view"><AlertTriangle size={18} /><div><strong>{t('conversationUnavailable')}</strong><p>{query.error.message}</p></div></div>;
  if (entries.length === 0) return <div className="empty-state"><MessageSquareText size={22} /><strong>{t('noConversation')}</strong><span>{t('noConversationDesc')}</span></div>;
  return <div className="conversation-view"><div className="conversation-toolbar"><div><strong>{t('contextTranscript')}</strong><span>{scope === 'call' ? t('transcriptCount', { shown: visible.length, total: entries.length, seq: frame.seq }) : t('sessionTranscriptCount', { shown: visible.length, total: entries.length })}</span></div><div className="conversation-controls"><div className="segmented" aria-label={t('conversationScope')}><button className={scope === 'call' ? 'active' : ''} onClick={() => changeScope('call')}>{t('currentCall')}</button><button className={scope === 'session' ? 'active' : ''} onClick={() => changeScope('session')}>{t('fullSession')}</button></div><div className="segmented" aria-label={t('conversationFilter')}>{(['messages', 'tools', 'all'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'messages' ? t('messages') : value === 'tools' ? t('toolActivity') : t('allContent')}</button>)}</div><label className="content-search"><Search size={14} /><span className="sr-only">{t('searchContent')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('findContext')} /></label></div></div><div className="coverage-explainer"><Info size={14} /><div><strong>{t('coverageTitle')}</strong><span>{t('coverageBody')}</span></div></div><div className="message-list">{displayed.map((entry) => { const isTool = entry.kind === 'tool_result' || (entry.kind === 'assistant' && Boolean(entry.source)); const Icon = entry.kind === 'user' || entry.kind === 'summary' ? UserRound : isTool ? TerminalSquare : Bot; const role = entry.kind === 'tool_result' ? t('toolResult') : isTool ? t('toolCall') : entry.kind === 'user' ? t('user') : entry.kind === 'summary' ? t('summary') : t('assistant'); if (isTool) return <details key={entry.id} className="tool-block"><summary><Icon size={15} /><strong>{entry.source ?? role}</strong><span>{role}</span><small>{t('recordMeta', { tokens: fmtTokens(entry.tokens), record: entry.record })}</small></summary><pre>{entry.content}</pre></details>; return <article key={entry.id} className={`message-block message-${entry.kind}`}><header><span className="message-icon"><Icon size={15} /></span><strong>{role}</strong><small>{t('recordMeta', { tokens: fmtTokens(entry.tokens), record: entry.record })}</small></header><pre>{entry.content}</pre></article>; })}{displayed.length < visible.length && <button className="load-more conversation-more" onClick={() => setEntryLimit((value) => value + 150)}>{t('loadMore')}<span>{visible.length - displayed.length}</span></button>}{visible.length === 0 && <div className="empty-state compact"><Search size={18} /><strong>{t('noMatchingContent')}</strong><span>{t('noMatchingContentDesc')}</span></div>}</div></div>;
}

export function ToolsView({ report }: { report: AnalysisReport }) {
  const { t } = useI18n();
  return <div className="table-wrap tools-view"><table><thead><tr><th>{t('tool')}</th><th>{t('server')}</th><th className="number">{t('toolCalls')}</th><th className="number">{t('toolInputs')}</th><th className="number">{t('toolResults')}</th><th className="number">{t('total')}<HelpTip content={t('toolTokenAccountingHelp')} /></th></tr></thead><tbody>{report.tools.called.map((tool) => <tr key={tool.name}><td><Wrench size={14} /> {tool.name}</td><td>{tool.server ?? t('builtIn')}</td><td className="number mono">{tool.calls}</td><td className="number mono">{fmtTokens(tool.inputTokens)}</td><td className="number mono">{fmtTokens(tool.resultTokens)}</td><td className="number mono strong">{fmtTokens(tool.inputTokens + tool.resultTokens)}</td></tr>)}</tbody></table>{report.tools.called.length === 0 && <div className="empty-state"><Wrench size={20} /><strong>{t('noToolActivity')}</strong><span>{t('noToolActivityDesc')}</span></div>}</div>;
}

export function AnomaliesView({ report }: { report: AnalysisReport }) {
  const { t } = useI18n();
  if (report.anomalies.length === 0) return <div className="empty-state success"><CheckCircle2 size={22} /><strong>{t('noParserIssues')}</strong><span>{t('noParserIssuesDesc')}</span></div>;
  return <div className="anomaly-list">{report.anomalies.map((anomaly, index) => <article key={`${anomaly.atRecord}-${index}`}><AlertTriangle size={16} /><div><strong>{anomaly.code}</strong><span>{t('record', { record: anomaly.atRecord })}</span><p>{anomaly.detail}</p>{anomaly.redactedSample && <code>{anomaly.redactedSample}</code>}</div></article>)}</div>;
}
