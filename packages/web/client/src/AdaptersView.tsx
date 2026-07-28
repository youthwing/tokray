import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, Database, FileJson2, LockKeyhole, PlugZap } from 'lucide-react';
import { api } from './api';
import { useI18n } from './i18n';

function sourceBoundary(id: string, locale: string, fallback: string): string {
  const notes: Record<string, [string, string]> = {
    'claude-code': ['JSONL 会话，可读取模型 Usage 与压缩标记。', 'JSONL sessions with model Usage and compaction markers.'],
    codex: ['JSONL rollout 会话，可读取 token_count 事件。', 'JSONL rollout sessions with token_count events.'],
    'raw-request': ['Tokray model_call JSONL 完整请求采集目录。', 'Tokray model_call JSONL complete-request capture directory.'],
    cursor: ['可检测本地存储；仍需经过验证的 SQLite/state 适配器。', 'Local stores are detectable; a verified SQLite/state adapter is still required.'],
    cline: ['任务历史基于文件保存，但需要专用的多文件适配器。', 'Task history is file-based but needs a dedicated multi-file adapter.'],
    'roo-code': ['任务历史基于文件保存，但需要专用的多文件适配器。', 'Task history is file-based but needs a dedicated multi-file adapter.'],
    continue: ['不同版本的会话导出格式不一，需要真实样本验证。', 'Session exports vary by version and require verified fixtures.'],
    windsurf: ['可检测 VS Code 派生存储；不会假设其中包含完整请求。', 'VS Code-derived storage is detectable; complete request visibility is not assumed.'],
    'gemini-cli': ['聊天文件需要经过版本验证的适配器才能分析。', 'Chat files require a verified, versioned adapter before analysis.'],
    codebuddy: ['可检测安装；直接日志与 Hook 能力仍需要本机真实样本验证。', 'Installation can be detected; log and Hook capabilities still require a verified fixture.'],
    trae: ['已发现的 ai-agent 数据库为加密或不透明存储，需要 Hook 或完整请求采集器。', 'The observed ai-agent database is encrypted or opaque; use a verified Hook or request collector.'],
  };
  const note = notes[id];
  return note ? note[locale === 'zh-CN' ? 0 : 1] : fallback;
}

export function AdaptersView() {
  const { locale } = useI18n();
  const sources = useQuery({ queryKey: ['agent-sources'], queryFn: api.agentSources, staleTime: 30_000 });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 30_000 });
  const copy = locale === 'zh-CN' ? {
    title: 'Agent 与适配器', subtitle: '安装状态、可观测边界与自定义格式', detected: '已检测', configured: '自定义来源', adapters: '已加载适配器', issues: '配置问题',
    agent: 'Agent', local: '本机状态', access: '读取能力', location: '数据位置', boundary: '能力边界', available: '已安装', absent: '未发现',
    parsed: '可直接解析', required: '需要适配器', opaque: '存储不可读', noPath: '未检测到默认路径', configFiles: '配置文件', builtInOnly: '仅使用默认配置',
    declarative: '声明式 JSONL', declarativeDetail: '通过 tokray.config.json 映射自定义模型调用记录', noIssues: '配置有效', loading: '正在检查本机 Agent 来源...', agentsUnit: '个 Agent', customUnit: '个自定义', detectionNote: '检测到安装不等于可解析；读取能力一栏代表当前真实支持边界。',
  } : {
    title: 'Agents and adapters', subtitle: 'Installation state, observability boundaries, and custom formats', detected: 'Detected', configured: 'Custom sources', adapters: 'Loaded adapters', issues: 'Config issues',
    agent: 'Agent', local: 'Local state', access: 'Read access', location: 'Data location', boundary: 'Capability boundary', available: 'Installed', absent: 'Not found',
    parsed: 'Directly parsed', required: 'Adapter required', opaque: 'Opaque storage', noPath: 'No default path detected', configFiles: 'Config files', builtInOnly: 'Using defaults only',
    declarative: 'Declarative JSONL', declarativeDetail: 'Map custom model-call records through tokray.config.json', noIssues: 'Configuration valid', loading: 'Inspecting local Agent sources...', agentsUnit: 'agents', customUnit: 'custom', detectionNote: 'Detection does not imply parsing support; read access states the current verified boundary.',
  };
  if (sources.isLoading || config.isLoading) return <div className="adapter-loading">{copy.loading}</div>;
  if (sources.error || config.error) return <div className="error-view"><AlertTriangle size={18} /><div><strong>{copy.title}</strong><p>{(sources.error ?? config.error)?.message}</p></div></div>;
  const sourceRows = sources.data ?? [];
  const configData = config.data!;
  const customAdapters = configData.adapters.filter((id) => !['claude-code', 'codex', 'raw-request'].includes(id));
  const availableCount = sourceRows.filter((source) => source.available).length;
  return (
    <section className="adapters-view">
      <header className="page-heading"><div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div><PlugZap size={20} /></header>
      <section className="metric-strip adapter-metrics">
        <div className="metric"><span>{copy.detected}</span><strong>{availableCount}</strong><small>{sourceRows.length} {copy.agentsUnit}</small></div>
        <div className="metric"><span>{copy.configured}</span><strong>{configData.sourceCount}</strong><small>{copy.configFiles}</small></div>
        <div className="metric"><span>{copy.adapters}</span><strong>{configData.adapters.length}</strong><small>{customAdapters.length} {copy.customUnit}</small></div>
        <div className={`metric ${configData.issues.length > 0 ? 'metric-warning' : ''}`}><span>{copy.issues}</span><strong>{configData.issues.length}</strong><small>{configData.issues.length === 0 ? copy.noIssues : configData.files.join(', ')}</small></div>
      </section>

      <div className="declarative-band"><FileJson2 size={18} /><div><strong>{copy.declarative}</strong><span>{copy.declarativeDetail}</span></div><code>{configData.files.join(', ') || copy.builtInOnly}</code></div>
      <p className="adapter-boundary-note"><AlertTriangle size={13} />{copy.detectionNote}</p>

      {configData.issues.length > 0 && <section className="config-issues" aria-label={copy.issues}>{configData.issues.map((issue, index) => <div key={`${issue.file}-${issue.path}-${index}`}><AlertTriangle size={14} /><code>{issue.file}{issue.path}</code><span>{issue.message}</span></div>)}</section>}

      <div className="table-wrap adapter-table-wrap">
        <table className="adapter-table">
          <thead><tr><th>{copy.agent}</th><th>{copy.local}</th><th>{copy.access}</th><th>{copy.location}</th><th>{copy.boundary}</th></tr></thead>
          <tbody>
            {sourceRows.map((source) => {
              const accessLabel = source.access === 'parsed' ? copy.parsed : source.access === 'adapter-required' ? copy.required : copy.opaque;
              const AccessIcon = source.access === 'parsed' ? Database : source.access === 'adapter-required' ? CircleDashed : LockKeyhole;
              return <tr key={source.id}>
                <td><strong>{source.label}</strong><small className="mono">{source.agent}</small></td>
                <td>{source.available ? <span className="source-state available"><CheckCircle2 size={13} />{copy.available}</span> : <span className="source-state"><CircleDashed size={13} />{copy.absent}</span>}</td>
                <td><span className={`access-state access-${source.access}`}><AccessIcon size={13} />{accessLabel}</span></td>
                <td className="path-list">{source.availablePaths.length > 0 ? source.availablePaths.map((path) => <code key={path}>{path}</code>) : <span>{copy.noPath}</span>}</td>
                <td className="boundary-copy">{sourceBoundary(source.id, locale, source.note)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
