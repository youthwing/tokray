import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Languages,
  ListChecks,
  MessageSquareText,
  Minimize2,
  Moon,
  PlugZap,
  Radio,
  RefreshCw,
  Rows3,
  Search,
  ShieldCheck,
  Sun,
  Wrench,
} from 'lucide-react';
import type { LocalSession, SessionFinding } from '@tokray/node';
import { api } from './api';
import { AdaptersView } from './AdaptersView';
import { fmtBytes, fmtDate, fmtTokens } from './format';
import { GlossaryView } from './GlossaryView';
import { GovernanceCenter } from './GovernanceCenter';
import { HelpTip } from './HelpTip';
import { LiveMonitor } from './LiveMonitor';
import type { StreamState } from './LiveMonitor';
import { Timeline } from './Timeline';
import { AnomaliesView, CompactionView, ConversationView, DiagnosisView, FrameInspector, Overview, ToolsView, UsageView } from './Views';
import { useI18n } from './i18n';

type Tab = 'overview' | 'conversation' | 'usage' | 'compaction' | 'frames' | 'tools' | 'anomalies';
type Theme = 'light' | 'dark';
type WorkspaceView = 'live' | 'sessions' | 'governance' | 'adapters' | 'glossary';
type SessionRow = { kind: 'group'; id: string; label: string; count: number } | { kind: 'session'; session: LocalSession };

function agentLabel(agent: string, rawRequest: string): string {
  const labels: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    'raw-request': rawRequest,
    cursor: 'Cursor',
    cline: 'Cline',
    'roo-code': 'Roo Code',
    continue: 'Continue',
    windsurf: 'Windsurf',
    'gemini-cli': 'Gemini CLI',
    codebuddy: 'CodeBuddy',
    trae: 'Trae',
  };
  return labels[agent] ?? agent;
}

function groupedRows(sessions: readonly LocalSession[], locale: string): SessionRow[] {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const groups = [
    { id: 'active', label: locale === 'zh-CN' ? '活跃' : 'Active', sessions: sessions.filter((session) => now - session.modifiedAt < 5 * 60_000) },
    { id: 'today', label: locale === 'zh-CN' ? '今天' : 'Today', sessions: sessions.filter((session) => now - session.modifiedAt >= 5 * 60_000 && session.modifiedAt >= startOfToday.getTime()) },
    { id: 'earlier', label: locale === 'zh-CN' ? '更早' : 'Earlier', sessions: sessions.filter((session) => session.modifiedAt < startOfToday.getTime()) },
  ];
  return groups.flatMap((group) => group.sessions.length > 0
    ? [{ kind: 'group' as const, id: group.id, label: group.label, count: group.sessions.length }, ...group.sessions.map((session) => ({ kind: 'session' as const, session }))]
    : []);
}

function SessionRail({
  sessions,
  matchingTotal,
  agents,
  agentFilter,
  selectedId,
  search,
  workspaceView,
  onSearch,
  onAgent,
  onSelect,
  onWorkspace,
}: {
  sessions: LocalSession[];
  matchingTotal: number;
  agents: Array<{ id: string; count: number }>;
  agentFilter: string;
  selectedId: string | undefined;
  search: string;
  workspaceView: WorkspaceView;
  onSearch: (value: string) => void;
  onAgent: (value: string) => void;
  onSelect: (id: string) => void;
  onWorkspace: (view: WorkspaceView) => void;
}) {
  const { locale, t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [copiedId, setCopiedId] = useState<string>();
  const rows = useMemo(() => groupedRows(sessions, locale), [locale, sessions]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index]?.kind === 'group' ? 32 : 66,
    overscan: 10,
    getItemKey: (index) => rows[index]?.kind === 'group' ? `group:${rows[index].id}` : `session:${rows[index]?.session.id}`,
  });
  const copy = locale === 'zh-CN' ? {
    live: '实时监控', sessions: '会话分析', governance: '治理中心', adapters: '适配器', glossary: '术语库', search: '搜索标题、路径或 Session ID', scope: '标题 / 路径 / ID', filter: 'Agent 筛选', recent: '最近会话', copyId: '复制 Session ID', copied: '已复制',
  } : {
    live: 'Live monitor', sessions: 'Session analysis', governance: 'Governance', adapters: 'Adapters', glossary: 'Glossary', search: 'Search title, path, or Session ID', scope: 'Title / path / ID', filter: 'Agent filter', recent: 'Recent sessions', copyId: 'Copy Session ID', copied: 'Copied',
  };
  const navItems = [
    ['live', Radio, copy.live],
    ['sessions', BarChart3, copy.sessions],
    ['governance', ListChecks, copy.governance],
    ['adapters', PlugZap, copy.adapters],
    ['glossary', BookOpen, copy.glossary],
  ] as const;
  const copySessionId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => current === id ? undefined : current), 1_500);
    } catch {
      setCopiedId(undefined);
    }
  };
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  return (
    <aside className="session-rail">
      <div className="brand"><span className="brand-mark"><img src="/tokray-mark.svg" alt="" /></span><span className="brand-copy"><strong>Tokray</strong><small>{t('contextAuditor')}</small></span><span className="local-state"><ShieldCheck size={12} />{t('local')}</span></div>
      <nav className="workspace-nav" aria-label={copy.sessions}>
        {navItems.map(([id, Icon, label]) => <button key={id} className={workspaceView === id ? 'active' : ''} onClick={() => onWorkspace(id)}><Icon size={16} /><span>{label}</span>{id === 'live' && <i />}</button>)}
      </nav>
      <div className="rail-controls">
        <label className="agent-select"><span>{copy.filter}</span><select value={agentFilter} onChange={(event) => onAgent(event.target.value)}><option value="all">{t('allAgents')} ({agents.reduce((sum, item) => sum + item.count, 0)})</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agentLabel(agent.id, t('rawRequest'))} ({agent.count})</option>)}</select></label>
        <label className="session-search"><Search size={14} /><span className="sr-only">{copy.search}</span><input ref={searchInputRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={copy.search} /></label>
        <div className="search-scope"><span>{copy.scope}</span><kbd>/</kbd></div>
      </div>
      <div className="rail-label"><span>{copy.recent}</span><span>{matchingTotal}</span></div>
      <div className="session-list" ref={parentRef}>
        {rows.length === 0 ? <div className="rail-empty">{t('noMatchingSessions')}</div> : <div className="virtual-session-list" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return <div key={item.key} className={`virtual-session-row virtual-${row.kind}`} style={{ transform: `translateY(${item.start}px)` }}>
              {row.kind === 'group' ? <div className="session-group"><span>{row.label}</span><strong>{row.count}</strong></div> : <div className={row.session.id === selectedId ? 'session-row selected' : 'session-row'}>
                <button className="session-item" onClick={() => onSelect(row.session.id)} aria-current={row.session.id === selectedId ? 'page' : undefined}>
                  <span className={`agent-mark agent-${row.session.agent}`} />
                  <span className="session-copy"><strong>{row.session.title}</strong><small>{agentLabel(row.session.agent, t('rawRequest'))} · {fmtDate(row.session.modifiedAt, locale)} · {fmtBytes(row.session.bytes)}</small><code>#{row.session.id.slice(0, 8)}</code></span>
                  <ChevronRight size={14} />
                </button>
                <button className="copy-session" onClick={() => void copySessionId(row.session.id)} title={copiedId === row.session.id ? copy.copied : copy.copyId} aria-label={copy.copyId}>{copiedId === row.session.id ? <Check size={13} /> : <Copy size={13} />}</button>
              </div>}
            </div>;
          })}
        </div>}
      </div>
      <div className="privacy-note"><CircleHelp size={14} /><span>{t('privacy')}</span></div>
    </aside>
  );
}

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('tokray-theme') ?? window.localStorage.getItem('ctxray-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialWorkspaceView(): WorkspaceView {
  const view = window.location.hash.slice(1);
  return view === 'sessions' || view === 'governance' || view === 'adapters' || view === 'glossary' ? view : 'live';
}

export default function App() {
  const { locale, setLocale, t } = useI18n();
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({ queryKey: ['sessions'], queryFn: api.sessions, refetchInterval: 60_000 });
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedSeq, setSelectedSeq] = useState(1);
  const [tab, setTab] = useState<Tab>('overview');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(initialWorkspaceView);
  const [agentFilter, setAgentFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [streamState, setStreamState] = useState<StreamState>('connecting');
  const [lastEventAt, setLastEventAt] = useState(Date.now());
  const [autoFollow, setAutoFollow] = useState(true);
  const sessions = sessionsQuery.data ?? [];
  const agents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) counts.set(session.agent, (counts.get(session.agent) ?? 0) + 1);
    return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  }, [sessions]);
  const filteredSessions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      if (agentFilter !== 'all' && session.agent !== agentFilter) return false;
      return !needle || `${session.title} ${session.location} ${session.agent} ${session.adapter} ${session.id}`.toLocaleLowerCase().includes(needle);
    });
  }, [agentFilter, search, sessions]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('tokray-theme', theme);
    window.localStorage.removeItem('ctxray-theme');
  }, [theme]);
  useEffect(() => {
    window.history.replaceState(null, '', `#${workspaceView}`);
  }, [workspaceView]);
  useEffect(() => {
    const events = new EventSource('/api/events');
    let refreshTimer: number | undefined;
    let lastSignal = Date.now();
    const signal = () => {
      lastSignal = Date.now();
      setLastEventAt(lastSignal);
      setStreamState('live');
    };
    const refreshFromDisk = () => {
      signal();
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        void queryClient.invalidateQueries({ queryKey: ['analysis'] });
        void queryClient.invalidateQueries({ queryKey: ['conversation'] });
        void queryClient.invalidateQueries({ queryKey: ['agent-sources'] });
      }, 200);
    };
    const freshness = window.setInterval(() => {
      if (Date.now() - lastSignal > 30_000) setStreamState('stale');
    }, 5_000);
    events.onopen = signal;
    events.onerror = () => setStreamState('disconnected');
    events.addEventListener('connected', signal);
    events.addEventListener('heartbeat', signal);
    events.addEventListener('sessions-changed', refreshFromDisk);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(freshness);
      events.removeEventListener('connected', signal);
      events.removeEventListener('heartbeat', signal);
      events.removeEventListener('sessions-changed', refreshFromDisk);
      events.close();
    };
  }, [queryClient]);
  useEffect(() => {
    if (!selectedId && filteredSessions[0]) setSelectedId(filteredSessions[0].id);
    else if (selectedId && !filteredSessions.some((session) => session.id === selectedId)) setSelectedId(filteredSessions[0]?.id);
  }, [filteredSessions, selectedId]);
  useEffect(() => {
    if (workspaceView === 'live' && autoFollow && filteredSessions[0] && filteredSessions[0].id !== selectedId) {
      setSelectedId(filteredSessions[0].id);
    }
  }, [autoFollow, filteredSessions, selectedId, workspaceView]);

  const analysisQuery = useQuery({
    queryKey: ['analysis', selectedId],
    queryFn: () => api.analysis(selectedId!),
    enabled: selectedId !== undefined && (workspaceView === 'live' || workspaceView === 'sessions' || workspaceView === 'governance'),
  });
  const report = analysisQuery.data;
  useEffect(() => {
    if (report?.frames.length) setSelectedSeq(report.frames.at(-1)!.seq);
  }, [report]);
  const selectedFrame = useMemo(() => report?.frames.find((frame) => frame.seq === selectedSeq) ?? report?.frames.at(-1), [report, selectedSeq]);
  const selectedQuality = selectedFrame
    ? report?.capabilities.accounting === 'exact-request' || selectedFrame.calibration.r2 >= 0.9
      ? 'high'
      : selectedFrame.calibration.r2 >= 0.7
        ? 'medium'
        : 'low'
    : undefined;
  const refresh = useMutation({
    mutationFn: api.clearCache,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['analysis'] });
      await queryClient.invalidateQueries({ queryKey: ['conversation'] });
      await queryClient.invalidateQueries({ queryKey: ['agent-sources'] });
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
  const chooseWorkspace = (view: WorkspaceView) => {
    setWorkspaceView(view);
    if (view === 'live') setAutoFollow(true);
  };
  const chooseAgent = (value: string) => {
    setAgentFilter(value);
    setSearch('');
    const next = sessions.find((session) => value === 'all' || session.agent === value);
    setSelectedId(next?.id);
    setSelectedSeq(1);
    setAutoFollow(true);
    if (workspaceView !== 'governance') setWorkspaceView('live');
  };
  const chooseSession = (id: string) => {
    setSelectedId(id);
    setAutoFollow(false);
    if (workspaceView !== 'governance') setWorkspaceView('sessions');
    setTab('overview');
  };
  const navigateToFinding = (finding: SessionFinding) => {
    if ('frameSeq' in finding) setSelectedSeq(finding.frameSeq);
    setWorkspaceView('sessions');
    setTab(finding.target);
    if (finding.target === 'overview') {
      window.requestAnimationFrame(() => document.getElementById('calibration-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const pageCopy = locale === 'zh-CN'
    ? { live: '实时监控', sessions: '会话分析', governance: '治理中心', adapters: '适配器', glossary: '术语库', noSelection: '选择一个本地 Agent 会话', matrix: 'Agent 能力矩阵', vocabulary: 'Token 与上下文术语', governanceScope: '当前会话的治理提案与执行预览', skip: '跳到主要内容', workspace: '工作区' }
    : { live: 'Live monitor', sessions: 'Session analysis', governance: 'Governance', adapters: 'Adapters', glossary: 'Glossary', noSelection: 'Select a local Agent session', matrix: 'Agent capability matrix', vocabulary: 'Token and context vocabulary', governanceScope: 'Action proposals and execution previews for the selected session', skip: 'Skip to main content', workspace: 'Workspace' };
  const pageTitle = workspaceView === 'sessions' ? report?.session.title ?? pageCopy.sessions : pageCopy[workspaceView];
  const pageSubtitle = workspaceView === 'sessions'
    ? report?.session.location ?? pageCopy.noSelection
    : workspaceView === 'live'
      ? report ? `${report.session.title} · ${report.session.location}` : pageCopy.noSelection
      : workspaceView === 'governance'
        ? report ? `${report.session.title} · ${pageCopy.governanceScope}` : pageCopy.noSelection
      : workspaceView === 'adapters'
        ? pageCopy.matrix
        : pageCopy.vocabulary;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{pageCopy.skip}</a>
      <SessionRail sessions={filteredSessions} matchingTotal={filteredSessions.length} agents={agents} agentFilter={agentFilter} selectedId={selectedId} search={search} workspaceView={workspaceView} onSearch={setSearch} onAgent={chooseAgent} onSelect={chooseSession} onWorkspace={chooseWorkspace} />
      <main className="workspace" id="main-content">
        <header className="topbar">
          <div className="mobile-brand"><img src="/tokray-mark.svg" alt="" /><strong>Tokray</strong></div>
          <select className="mobile-workspace-select" value={workspaceView} onChange={(event) => chooseWorkspace(event.target.value as WorkspaceView)} aria-label={pageCopy.workspace}><option value="live">{pageCopy.live}</option><option value="sessions">{pageCopy.sessions}</option><option value="governance">{pageCopy.governance}</option><option value="adapters">{pageCopy.adapters}</option><option value="glossary">{pageCopy.glossary}</option></select>
          {(workspaceView === 'live' || workspaceView === 'sessions' || workspaceView === 'governance') && <select className="mobile-agent-select" value={agentFilter} onChange={(event) => chooseAgent(event.target.value)} aria-label={t('agent')}><option value="all">{t('allAgents')}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agentLabel(agent.id, t('rawRequest'))} ({agent.count})</option>)}</select>}
          {(workspaceView === 'live' || workspaceView === 'sessions' || workspaceView === 'governance') && <select className="mobile-session-select" value={selectedId ?? ''} onChange={(event) => chooseSession(event.target.value)} aria-label={t('session')}>{filteredSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select>}
          <div className="session-heading">
            <div><h1>{pageTitle}</h1><p>{pageSubtitle}</p></div>
            {workspaceView === 'sessions' && report && <div className="session-meta"><span className={`adapter-badge adapter-${report.session.adapter}`}>{agentLabel(report.session.agent, t('rawRequest'))}</span><span>{t('calls', { count: report.frames.length })}</span><span>{t('finalTokens', { tokens: fmtTokens(report.finalTokens) })}</span>{selectedQuality && <span className={`quality quality-${selectedQuality}`}>{t('dataQuality')}: {t(selectedQuality === 'high' ? 'qualityHigh' : selectedQuality === 'medium' ? 'qualityMedium' : 'qualityLow')}<HelpTip content={t('dataQualityHelp')} /></span>}</div>}
          </div>
          <div className="topbar-actions">
            <button className="icon-button language-button" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')} title={locale === 'en' ? t('switchChinese') : t('switchEnglish')} aria-label={locale === 'en' ? t('switchChinese') : t('switchEnglish')}><Languages size={15} /><span>{locale === 'en' ? '中' : 'EN'}</span></button>
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={theme === 'light' ? t('switchDark') : t('switchLight')} aria-label={theme === 'light' ? t('switchDark') : t('switchLight')}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
            <button className="icon-button" onClick={() => refresh.mutate()} disabled={refresh.isPending} title={t('refreshSessions')} aria-label={t('refreshSessions')}><RefreshCw size={16} className={refresh.isPending ? 'spin' : ''} /></button>
          </div>
        </header>

        {(sessionsQuery.isLoading || ((workspaceView === 'live' || workspaceView === 'sessions' || workspaceView === 'governance') && analysisQuery.isLoading)) && <div className="loading-view" aria-label={t('readingData')}><div /><div /><div /><span>{t('readingData')}</span></div>}
        {(sessionsQuery.error || analysisQuery.error) && <div className="error-view"><AlertTriangle size={20} /><div><strong>{t('analysisUnavailable')}</strong><p>{(sessionsQuery.error ?? analysisQuery.error)?.message}</p></div><button onClick={() => void queryClient.invalidateQueries()}>{t('tryAgain')}</button></div>}
        {!sessionsQuery.isLoading && sessions.length === 0 && (workspaceView === 'live' || workspaceView === 'sessions' || workspaceView === 'governance') && <div className="empty-state page-empty"><Boxes size={24} /><strong>{t('noSupportedSessions')}</strong><span>{t('noSupportedSessionsDesc')}</span></div>}

        {workspaceView === 'live' && report && selectedFrame && <LiveMonitor report={report} selectedSeq={selectedSeq} streamState={streamState} lastEventAt={lastEventAt} autoFollow={autoFollow} theme={theme} onAutoFollow={setAutoFollow} onSelectSeq={(seq) => { setSelectedSeq(seq); setAutoFollow(false); }} onInspect={(seq) => { setSelectedSeq(seq); setWorkspaceView('sessions'); setTab('overview'); }} />}
        {workspaceView === 'governance' && report && <GovernanceCenter report={report} onNavigate={navigateToFinding} />}
        {workspaceView === 'adapters' && <AdaptersView />}
        {workspaceView === 'glossary' && <GlossaryView />}
        {workspaceView === 'sessions' && report && selectedFrame && <>
          <nav className="tabs" aria-label={t('analysisViews')}>
            {([
              ['overview', BarChart3, t('overview')],
              ['conversation', MessageSquareText, t('conversation')],
              ['usage', Activity, t('usage')],
              ['compaction', Minimize2, t('compaction', { count: report.compactions.length || '' })],
              ['frames', Rows3, t('blocks')],
              ['tools', Wrench, t('tools')],
              ['anomalies', AlertTriangle, t('issues', { count: report.anomalies.length || '' })],
            ] as const).map(([id, Icon, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}</button>)}
          </nav>
          <section className="content-band">
            {tab === 'overview' && <><DiagnosisView report={report} onNavigate={navigateToFinding} /><section className="timeline-section"><div className="band-heading"><div><h2>{t('contextOverTime')}</h2><p>{t('compositionAcross', { count: report.frames.length })}</p></div><div className="frame-selection"><span>{t('selectedCall')}</span><strong>#{selectedSeq}</strong><small>{t('inputShort', { tokens: fmtTokens(selectedFrame.totals.input) })}</small></div></div><Timeline frames={report.frames} selectedSeq={selectedSeq} onSelect={setSelectedSeq} theme={theme} /></section><Overview report={report} frame={selectedFrame} /></>}
            {tab === 'conversation' && <ConversationView sessionId={report.session.id} frame={selectedFrame} />}
            {tab === 'usage' && <UsageView report={report} theme={theme} />}
            {tab === 'compaction' && <CompactionView report={report} />}
            {tab === 'frames' && <FrameInspector frame={selectedFrame} />}
            {tab === 'tools' && <ToolsView report={report} />}
            {tab === 'anomalies' && <AnomaliesView report={report} />}
          </section>
        </>}
      </main>
    </div>
  );
}
