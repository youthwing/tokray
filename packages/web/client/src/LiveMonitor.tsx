import { Activity, AlertTriangle, ArrowRight, Pause, Play, Radio, WifiOff } from 'lucide-react';
import type { AnalysisReport } from '@tokray/node';
import { fmtTokens } from './format';
import { HelpTip } from './HelpTip';
import { Timeline } from './Timeline';
import { useI18n } from './i18n';

export type StreamState = 'connecting' | 'live' | 'stale' | 'disconnected';

interface LiveMonitorProps {
  report: AnalysisReport;
  selectedSeq: number;
  streamState: StreamState;
  lastEventAt: number;
  autoFollow: boolean;
  theme: 'light' | 'dark';
  onAutoFollow: (enabled: boolean) => void;
  onSelectSeq: (seq: number) => void;
  onInspect: (seq: number) => void;
}

function timeLabel(timestamp: number, locale: string): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp);
}

export function LiveMonitor({
  report,
  selectedSeq,
  streamState,
  lastEventAt,
  autoFollow,
  theme,
  onAutoFollow,
  onSelectSeq,
  onInspect,
}: LiveMonitorProps) {
  const { locale } = useI18n();
  const copy = locale === 'zh-CN' ? {
    title: '实时上下文监控',
    subtitle: '最新模型调用倒序更新',
    live: '实时',
    connecting: '连接中',
    stale: '更新延迟',
    disconnected: '已断开',
    lastSignal: '最近信号',
    autoFollow: '自动跟随',
    pauseFollow: '暂停自动跟随',
    resumeFollow: '恢复自动跟随',
    currentInput: '当前上下文',
    currentInputHelp: '最新一次模型调用实际可见的标准化输入 Token。',
    added: '本轮新增',
    addedHelp: '本轮首次进入上下文的可重建内容 Token。',
    cache: '缓存复用',
    cacheHelp: '供应商记录的当前调用缓存读取 Token。',
    cumulative: '累计输入',
    cumulativeHelp: '当前会话所有具有真实 Usage 的模型调用输入总和。',
    findings: '待处理问题',
    findingsHelp: '当前会话中由证据规则触发的问题数量，不是综合健康分。',
    timeline: '上下文变化',
    timelineDesc: '选择调用查看构成；最新调用保持在右侧',
    activity: '最新调用',
    activityDesc: '最近 120 次模型调用，按时间倒序',
    call: '调用',
    time: '时间',
    model: '模型',
    input: '输入',
    delta: '新增',
    cacheShort: '缓存',
    output: '输出',
    issues: '问题',
    inspect: '查看证据',
    noIssue: '无',
  } : {
    title: 'Live context monitor',
    subtitle: 'Newest model calls first',
    live: 'Live',
    connecting: 'Connecting',
    stale: 'Stale',
    disconnected: 'Disconnected',
    lastSignal: 'Last signal',
    autoFollow: 'Auto-follow',
    pauseFollow: 'Pause auto-follow',
    resumeFollow: 'Resume auto-follow',
    currentInput: 'Current context',
    currentInputHelp: 'Normalized model-visible input tokens for the latest call.',
    added: 'Added this call',
    addedHelp: 'Locally reconstructable tokens that first entered context in this call.',
    cache: 'Cache reused',
    cacheHelp: 'Provider-recorded cache-read tokens for the current call.',
    cumulative: 'Cumulative input',
    cumulativeHelp: 'Input summed across calls with real provider Usage in this session.',
    findings: 'Open findings',
    findingsHelp: 'Evidence-based findings in this session, not an opaque health score.',
    timeline: 'Context movement',
    timelineDesc: 'Select a call to inspect composition; newest remains on the right',
    activity: 'Latest calls',
    activityDesc: 'Most recent 120 model calls, newest first',
    call: 'Call',
    time: 'Time',
    model: 'Model',
    input: 'Input',
    delta: 'Added',
    cacheShort: 'Cache',
    output: 'Output',
    issues: 'Issues',
    inspect: 'Inspect evidence',
    noIssue: 'None',
  };
  const latest = report.frames.at(-1)!;
  const frameIssues = new Map<number, number>();
  for (const finding of report.diagnosis.findings) {
    if ('frameSeq' in finding) frameIssues.set(finding.frameSeq, (frameIssues.get(finding.frameSeq) ?? 0) + 1);
  }
  const recent = report.frames.slice(-120).reverse();
  const stateLabel = copy[streamState];
  const stateIcon = streamState === 'disconnected' ? <WifiOff size={14} /> : <Radio size={14} />;

  return (
    <section className="live-view" aria-labelledby="live-title">
      <div className="live-command-bar">
        <div>
          <div className={`stream-state stream-${streamState}`}>{stateIcon}<strong>{stateLabel}</strong><span>{copy.lastSignal} {timeLabel(lastEventAt, locale)}</span></div>
          <h2 id="live-title">{copy.title}</h2>
          <p>{copy.subtitle} · {report.session.title}</p>
        </div>
        <button className={autoFollow ? 'follow-toggle active' : 'follow-toggle'} onClick={() => onAutoFollow(!autoFollow)} aria-pressed={autoFollow} title={autoFollow ? copy.pauseFollow : copy.resumeFollow}>
          {autoFollow ? <Pause size={15} /> : <Play size={15} />}
          <span>{copy.autoFollow}</span>
        </button>
      </div>

      <section className="metric-strip live-metrics" aria-label={copy.title}>
        <div className="metric"><span>{copy.currentInput}<HelpTip content={copy.currentInputHelp} /></span><strong>{fmtTokens(latest.totals.input)}</strong><small>#{latest.seq}</small></div>
        <div className="metric"><span>{copy.added}<HelpTip content={copy.addedHelp} /></span><strong>+{fmtTokens(latest.delta.addedTokens)}</strong><small>{Math.round(latest.delta.addedTokens / Math.max(1, latest.totals.input) * 100)}%</small></div>
        <div className="metric"><span>{copy.cache}<HelpTip content={copy.cacheHelp} /></span><strong>{fmtTokens(latest.totals.cacheRead ?? 0)}</strong><small>{Math.round((latest.totals.cacheRead ?? 0) / Math.max(1, latest.totals.input) * 100)}%</small></div>
        <div className="metric"><span>{copy.cumulative}<HelpTip content={copy.cumulativeHelp} /></span><strong>{fmtTokens(report.usage.totals.input)}</strong><small>{report.usage.totals.calls} calls</small></div>
        <div className={`metric ${report.diagnosis.issueCount > 0 ? 'metric-warning' : ''}`}><span>{copy.findings}<HelpTip content={copy.findingsHelp} /></span><strong>{report.diagnosis.issueCount}</strong><small>{report.diagnosis.verdict}</small></div>
      </section>

      <section className="timeline-section live-timeline">
        <div className="band-heading"><div><h2>{copy.timeline}</h2><p>{copy.timelineDesc}</p></div><div className="frame-selection"><span>{copy.call}</span><strong>#{selectedSeq}</strong></div></div>
        <Timeline frames={report.frames} selectedSeq={selectedSeq} onSelect={onSelectSeq} theme={theme} />
      </section>

      <section className="activity-section">
        <div className="band-heading"><div><h2>{copy.activity}</h2><p>{copy.activityDesc}</p></div><Activity size={18} /></div>
        <div className="table-wrap live-table-wrap">
          <table className="live-table">
            <thead><tr><th>{copy.call}</th><th>{copy.time}</th><th>{copy.model}</th><th className="number">{copy.input}</th><th className="number">{copy.delta}</th><th className="number">{copy.cacheShort}</th><th className="number">{copy.output}</th><th>{copy.issues}</th><th><span className="sr-only">{copy.inspect}</span></th></tr></thead>
            <tbody>
              {recent.map((frame) => {
                const issues = frameIssues.get(frame.seq) ?? 0;
                return (
                  <tr key={frame.seq} className={frame.seq === selectedSeq ? 'selected-row' : ''}>
                    <td className="mono"><span className="activity-pulse" />#{frame.seq}</td>
                    <td className="mono">{timeLabel(frame.at, locale)}</td>
                    <td className="model-cell" title={frame.model.model}>{frame.model.model}</td>
                    <td className="number mono">{fmtTokens(frame.totals.input)}</td>
                    <td className="number mono delta-value">+{fmtTokens(frame.delta.addedTokens)}</td>
                    <td className="number mono">{fmtTokens(frame.totals.cacheRead ?? 0)}</td>
                    <td className="number mono">{fmtTokens(frame.totals.output ?? 0)}</td>
                    <td>{issues > 0 ? <span className="activity-issues"><AlertTriangle size={12} />{issues}</span> : <span className="activity-clear">{copy.noIssue}</span>}</td>
                    <td><button className="row-action" onClick={() => onInspect(frame.seq)} title={copy.inspect} aria-label={`${copy.inspect} #${frame.seq}`}><ArrowRight size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
