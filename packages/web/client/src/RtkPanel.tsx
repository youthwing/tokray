import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  CircleOff,
  Copy,
  DatabaseZap,
  ExternalLink,
  Import,
  LoaderCircle,
  Play,
  SearchCode,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react';
import { api } from './api';
import { fmtTokens } from './format';
import { useI18n } from './i18n';

export function RtkPanel() {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const chinese = locale === 'zh-CN';
  const [command, setCommand] = useState('git status');
  const [copied, setCopied] = useState(false);
  const [approved, setApproved] = useState(false);
  const statusQuery = useQuery({ queryKey: ['rtk-status'], queryFn: api.rtkStatus, staleTime: 30_000 });
  const gainMutation = useMutation({ mutationFn: api.importRtkGain });
  const rewriteMutation = useMutation({ mutationFn: api.previewRtkRewrite });
  const compareMutation = useMutation({
    mutationFn: ({ original, rewritten }: { original: string; rewritten: string }) => api.compareRtkOutput(original, rewritten),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['action-receipts'] }),
  });
  const status = gainMutation.data ?? statusQuery.data;
  const available = status?.availability === 'available';
  const gain = status?.gain;
  const copy = chinese ? {
    title: 'RTK 集成', subtitle: 'Rust Token Killer · 可选的命令输出压缩执行器', loading: '正在检测 RTK…', available: '可用', missing: '未安装', wrong: '同名程序不兼容', error: '检测失败',
    install: '安装命令', copy: '复制安装命令', copied: '已复制', official: '官方项目', version: '版本', importGain: '导入收益', importing: '正在导入', command: '命令重写预览', commandPlaceholder: '输入一条 Shell 命令', preview: '检查重写', checking: '检查中',
    original: '原命令', rewritten: 'RTK 命令', notExecuted: '只生成重写字符串，没有执行该命令', unsupported: 'RTK 当前不会重写这条命令', unavailable: '安装正确的 RTK 后可使用重写预览',
    commandCount: 'RTK 命令', rawOutput: '原始输出估算', compactOutput: '压缩输出估算', outputReduction: '输出缩减', actualInput: '实际输入节省', unverified: '待验证',
    estimateNote: 'RTK 使用 bytes / 4 估算 Bash 输出；缩减率不是模型总输入或账单节省率。', gainEmpty: '尚未导入 RTK 收益记录。', issue: '集成问题',
    approveRun: '我确认在当前 Tokray 工作目录运行原命令和 RTK 命令，各一次。仅支持低风险白名单。', runCompare: '运行输出对比', runningCompare: '正在执行两次', compareTitle: '实际输出对比', workingDirectory: '执行目录', exit: '退出码', bytes: '字节', lines: '行', estimatedTokens: '估算 Token', receipt: '操作凭证', truncated: '预览已截断', compareNote: '这是命令输出的 bytes / 4 估算，信息完整性与真实模型输入节省仍需后续 Usage 验证。',
  } : {
    title: 'RTK integration', subtitle: 'Rust Token Killer · optional command-output compression executor', loading: 'Detecting RTK…', available: 'Available', missing: 'Not installed', wrong: 'Incompatible name collision', error: 'Detection failed',
    install: 'Install command', copy: 'Copy install command', copied: 'Copied', official: 'Official project', version: 'Version', importGain: 'Import gain', importing: 'Importing', command: 'Command rewrite preview', commandPlaceholder: 'Enter one shell command', preview: 'Check rewrite', checking: 'Checking',
    original: 'Original', rewritten: 'RTK command', notExecuted: 'Only the rewrite string was generated; the command was not executed', unsupported: 'RTK does not rewrite this command', unavailable: 'Install the official RTK binary to preview rewrites',
    commandCount: 'RTK commands', rawOutput: 'Raw output estimate', compactOutput: 'Compact output estimate', outputReduction: 'Output reduction', actualInput: 'Actual input saving', unverified: 'Unverified',
    estimateNote: 'RTK estimates Bash output with bytes / 4; its reduction is not total model-input or billing savings.', gainEmpty: 'No RTK gain data has been imported.', issue: 'Integration issue',
    approveRun: 'I approve running the original and RTK commands once each in the current Tokray working directory. Only low-risk allowlisted commands are accepted.', runCompare: 'Run output comparison', runningCompare: 'Running twice', compareTitle: 'Measured output comparison', workingDirectory: 'Working directory', exit: 'Exit', bytes: 'bytes', lines: 'lines', estimatedTokens: 'estimated Tokens', receipt: 'Action receipt', truncated: 'Preview truncated', compareNote: 'This is a bytes / 4 command-output estimate. Information quality and actual model-input savings still require later Usage evidence.',
  };
  const availabilityLabel = status?.availability === 'available'
    ? copy.available
    : status?.availability === 'wrong-binary'
      ? copy.wrong
      : status?.availability === 'error'
        ? copy.error
        : copy.missing;
  const copyInstall = async () => {
    if (!status?.installCommand) return;
    try {
      await navigator.clipboard.writeText(status.installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  const preview = rewriteMutation.data;
  const comparisonExecution = compareMutation.data;
  const comparison = comparisonExecution?.comparison;
  const onCommandChange = (value: string) => {
    setCommand(value);
    setApproved(false);
    rewriteMutation.reset();
    compareMutation.reset();
  };
  const runComparison = () => {
    if (preview?.status !== 'ready' || !preview.rewritten || !approved) return;
    compareMutation.mutate({ original: preview.command, rewritten: preview.rewritten });
  };

  return <section className="rtk-integration" aria-labelledby="rtk-title">
    <header className="rtk-heading">
      <div className="rtk-identity"><span className="rtk-mark">RTK</span><div><h3 id="rtk-title">{copy.title}</h3><p>{copy.subtitle}</p></div></div>
      {statusQuery.isLoading
        ? <span className="rtk-status status-loading"><LoaderCircle size={13} className="spin" />{copy.loading}</span>
        : <span className={`rtk-status status-${status?.availability ?? 'error'}`}>{available ? <BadgeCheck size={13} /> : <CircleOff size={13} />}{availabilityLabel}</span>}
    </header>

    {!statusQuery.isLoading && !available && status && <div className="rtk-setup">
      <div><span>{copy.install}</span><code>{status.installCommand}</code></div>
      <button type="button" className="icon-button" onClick={() => void copyInstall()} title={copied ? copy.copied : copy.copy} aria-label={copy.copy}>{copied ? <BadgeCheck size={15} /> : <Copy size={15} />}</button>
      <a href="https://github.com/rtk-ai/rtk" target="_blank" rel="noreferrer"><ExternalLink size={14} />{copy.official}</a>
      {status.issue && <p><CircleOff size={13} /><strong>{copy.issue}:</strong> {status.issue}</p>}
    </div>}

    {available && status && <>
      <div className="rtk-toolbar">
        <span><BadgeCheck size={14} />{copy.version} <strong>{status.version}</strong></span>
        <button type="button" className="secondary-command" onClick={() => gainMutation.mutate()} disabled={gainMutation.isPending}><Import size={15} />{gainMutation.isPending ? copy.importing : copy.importGain}</button>
      </div>
      <form className="rtk-rewrite-form" onSubmit={(event) => { event.preventDefault(); rewriteMutation.mutate(command); }}>
        <label htmlFor="rtk-command"><TerminalSquare size={15} /><span>{copy.command}</span></label>
        <div><input id="rtk-command" value={command} onChange={(event) => onCommandChange(event.target.value)} placeholder={copy.commandPlaceholder} maxLength={4096} /><button type="submit" disabled={!command.trim() || rewriteMutation.isPending}><SearchCode size={15} />{rewriteMutation.isPending ? copy.checking : copy.preview}</button></div>
      </form>
      {preview && <div className={`rtk-rewrite-result rewrite-${preview.status}`}>
        {preview.status === 'ready' ? <>
          <div><span>{copy.original}</span><code>{preview.command}</code></div>
          <div><span>{copy.rewritten}</span><code>{preview.rewritten}</code></div>
          <p><ShieldCheck size={13} />{copy.notExecuted}</p>
          <div className="rtk-execution-approval">
            <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>{copy.approveRun}</span></label>
            <button type="button" className="primary-command" disabled={!approved || compareMutation.isPending} onClick={runComparison}><Play size={14} />{compareMutation.isPending ? copy.runningCompare : copy.runCompare}</button>
          </div>
        </> : <p><CircleOff size={13} />{preview.status === 'unsupported' ? copy.unsupported : preview.issue ?? copy.unavailable}</p>}
      </div>}
      {rewriteMutation.error && <div className="rtk-inline-error"><CircleOff size={13} />{rewriteMutation.error.message}</div>}
      {compareMutation.error && <div className="rtk-inline-error"><CircleOff size={13} />{compareMutation.error.message}</div>}
      {comparison && comparisonExecution && <section className="rtk-comparison" aria-label={copy.compareTitle}>
        <header><div><strong>{copy.compareTitle}</strong><code>{copy.workingDirectory}: {comparison.workingDirectory}</code></div><span>{Math.round(comparison.outputReductionPercentage)}% {copy.outputReduction}</span></header>
        <div className="rtk-output-columns">
          {[comparison.original, comparison.compact].map((output, index) => <article key={output.command}>
            <div><span>{index === 0 ? copy.original : copy.rewritten}</span><code>{output.command}</code></div>
            <dl><div><dt>{copy.exit}</dt><dd>{output.exitCode}</dd></div><div><dt>{copy.bytes}</dt><dd>{output.bytes}</dd></div><div><dt>{copy.lines}</dt><dd>{output.lines}</dd></div><div><dt>{copy.estimatedTokens}</dt><dd>{fmtTokens(output.estimatedTokens)}</dd></div></dl>
            <pre>{output.preview || '∅'}</pre>
            {output.previewTruncated && <small>{copy.truncated}</small>}
          </article>)}
        </div>
        <footer><span><ShieldCheck size={13} />{copy.compareNote}</span><code>{copy.receipt}: {comparisonExecution.receipt.id.slice(0, 8)}</code></footer>
      </section>}
    </>}

    {gain ? <div className="rtk-gain">
      <div><DatabaseZap size={15} /><span>{copy.commandCount}</span><strong>{gain.summary.totalCommands}</strong></div>
      <div><span>{copy.rawOutput}</span><strong>{fmtTokens(gain.summary.inputTokens)}</strong><small>bytes / 4</small></div>
      <div><span>{copy.compactOutput}</span><strong>{fmtTokens(gain.summary.outputTokens)}</strong><small>bytes / 4</small></div>
      <div><span>{copy.outputReduction}</span><strong>{Math.round(gain.summary.savingsPercentage)}%</strong><small>{fmtTokens(gain.summary.savedTokens)} estimated</small></div>
      <div className="rtk-actual"><span>{copy.actualInput}</span><strong>{copy.unverified}</strong><small>provider Usage required</small></div>
      <p><ShieldCheck size={13} />{copy.estimateNote}</p>
    </div> : available && <div className="rtk-empty"><DatabaseZap size={14} />{copy.gainEmpty}</div>}
  </section>;
}
