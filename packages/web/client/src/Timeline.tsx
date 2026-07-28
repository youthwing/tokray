import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { AnalysisFrame } from '@tokray/node';
import { fmtTokens } from './format';
import { useI18n } from './i18n';

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const KINDS = ['resident', 'system', 'user', 'assistant', 'tool_result', 'tool_schema', 'summary', 'unknown', 'unattributed'] as const;
const COLORS: Record<string, string> = {
  resident: '#8267b1', system: '#3d72aa', user: '#3f8d66', assistant: '#4b96a5',
  tool_result: '#bd8a31', tool_schema: '#a95f99', summary: '#70864b', unknown: '#bb555b', unattributed: '#87919d',
};

function chartColors(theme: 'light' | 'dark') {
  const dark = theme === 'dark';
  return {
    ink: dark ? '#c4cad2' : '#4b5563',
    grid: dark ? '#2b3139' : '#e7eaf0',
    line: dark ? '#3b424d' : '#d7dce4',
    tooltip: dark ? '#20252c' : '#ffffff',
    tooltipInk: dark ? '#edf0f4' : '#20242b',
  };
}

export function Timeline({ frames, selectedSeq, onSelect, theme }: {
  frames: AnalysisFrame[];
  selectedSeq: number;
  onSelect: (seq: number) => void;
  theme: 'light' | 'dark';
}) {
  const { t } = useI18n();
  const option = useMemo(() => {
    const colors = chartColors(theme);
    const labels: Record<string, string> = {
      resident: t('timelineResident'), system: t('timelineSystem'), user: t('timelineUser'), assistant: t('timelineAssistant'),
      tool_result: t('timelineToolResults'), tool_schema: t('timelineToolSchemas'), summary: t('timelineSummary'),
      unknown: t('timelineUnknown'), unattributed: t('timelineUnattributed'),
    };
    const composition = frames.map((frame) => {
      const calibrationReliable = frame.calibration.r2 >= 0.7 || frame.calibration.resident.value === 0;
      const residentValue = calibrationReliable ? Math.min(frame.calibration.resident.value, frame.totals.input) : 0;
      const known = Object.values(frame.kinds).reduce((sum, value) => sum + value, 0);
      const knownBudget = Math.max(0, frame.totals.input - residentValue);
      const scale = known > knownBudget && known > 0 ? knownBudget / known : 1;
      return { residentValue, scale, unattributed: Math.max(0, knownBudget - known * scale) };
    });
    const visibleKinds = KINDS.filter((kind) => kind === 'resident' || kind === 'unattributed' || frames.some((frame) => (frame.kinds[kind] ?? 0) > 0));
    return {
      animationDuration: 180,
      animationDurationUpdate: 180,
      backgroundColor: 'transparent',
      grid: { left: 58, right: 18, top: 42, bottom: frames.length > 30 ? 58 : 34 },
      legend: { top: 5, left: 52, itemWidth: 9, itemHeight: 9, textStyle: { color: colors.ink, fontSize: 11 }, data: visibleKinds.map((kind) => labels[kind]) },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#4d76b6', width: 1 } },
        backgroundColor: colors.tooltip,
        borderColor: colors.line,
        textStyle: { color: colors.tooltipInk, fontSize: 11 },
        formatter: (params: Array<{ axisValue: string; seriesName: string; value: number; marker: string }>) => {
          const frame = frames.find((item) => String(item.seq) === String(params[0]?.axisValue));
          return `<strong>${t('timelineFrame', { seq: params[0]?.axisValue ?? '' })}</strong><br/>${params.filter((item) => item.value > 0).map((item) => `${item.marker}${item.seriesName}: ${fmtTokens(item.value)}`).join('<br/>')}<br/><strong>${t('timelineTotal', { tokens: fmtTokens(frame?.totals.input ?? 0) })}</strong>`;
        },
      },
      xAxis: { type: 'category', data: frames.map((frame) => String(frame.seq)), axisLine: { lineStyle: { color: colors.line } }, axisLabel: { color: colors.ink, fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { formatter: (value: number) => fmtTokens(value), color: colors.ink, fontSize: 11 }, splitLine: { lineStyle: { color: colors.grid } } },
      dataZoom: frames.length > 30 ? [
        { type: 'inside', start: Math.max(0, 100 - (36 / frames.length) * 100), end: 100 },
        { type: 'slider', height: 13, bottom: 9, borderColor: 'transparent', backgroundColor: colors.grid, fillerColor: theme === 'dark' ? 'rgba(76,117,180,.46)' : 'rgba(76,117,180,.28)', handleStyle: { color: '#4d76b6' }, textStyle: { color: colors.ink } },
      ] : [],
      series: visibleKinds.map((kind, seriesIndex) => ({
        name: labels[kind], type: 'bar', stack: 'context', barMaxWidth: 26, emphasis: { focus: 'series' },
        itemStyle: { color: COLORS[kind], opacity: kind === 'resident' ? 0.72 : 0.88 },
        data: frames.map((frame, index) => ({
          value: kind === 'resident' ? composition[index]!.residentValue : kind === 'unattributed' ? composition[index]!.unattributed : (frame.kinds[kind] ?? 0) * composition[index]!.scale,
          itemStyle: { color: COLORS[kind], opacity: kind === 'resident' ? 0.72 : 0.88, ...(frame.seq === selectedSeq ? { borderColor: theme === 'dark' ? '#f2f4f7' : '#1d2530', borderWidth: 1 } : {}) },
        })),
        ...(seriesIndex === 0 ? {
          markLine: {
            symbol: 'none', label: { show: false }, lineStyle: { color: '#c76b45', type: 'dashed', width: 1 },
            data: frames.filter((frame) => frame.compactionRef !== undefined).map((frame) => ({ xAxis: String(frame.seq) })),
          },
        } : {}),
      })),
    };
  }, [frames, selectedSeq, t, theme]);

  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 286, width: '100%' }} onEvents={{ click: (params: { name?: string }) => params.name && onSelect(Number(params.name)) }} opts={{ renderer: 'canvas' }} />;
}

export function UsageTimeline({ frames, theme }: { frames: AnalysisFrame[]; theme: 'light' | 'dark' }) {
  const { t } = useI18n();
  const option = useMemo(() => {
    const colors = chartColors(theme);
    const zoom = frames.length > 45 ? [{ type: 'inside', start: Math.max(0, 100 - (45 / frames.length) * 100), end: 100 }] : [];
    return {
      animationDuration: 180,
      animationDurationUpdate: 180,
      backgroundColor: 'transparent',
      grid: { left: 62, right: 62, top: 56, bottom: 36 },
      legend: { top: 4, left: 56, right: 56, itemGap: 12, itemWidth: 16, itemHeight: 3, textStyle: { color: colors.ink, fontSize: 11 } },
      tooltip: { trigger: 'axis', backgroundColor: colors.tooltip, borderColor: colors.line, textStyle: { color: colors.tooltipInk, fontSize: 11 } },
      xAxis: { type: 'category', data: frames.map((frame) => String(frame.seq)), axisLine: { lineStyle: { color: colors.line } }, axisLabel: { color: colors.ink, fontSize: 11 } },
      yAxis: [
        { type: 'value', axisLabel: { formatter: (value: number) => fmtTokens(value), color: colors.ink, fontSize: 11 }, splitLine: { lineStyle: { color: colors.grid } } },
        { type: 'value', axisLabel: { formatter: (value: number) => fmtTokens(value), color: colors.ink, fontSize: 11 }, splitLine: { show: false } },
      ],
      dataZoom: zoom,
      series: [
        { name: t('usageInput'), type: 'line', data: frames.map((frame) => frame.totals.input), showSymbol: false, lineStyle: { width: 1.5, color: '#4d76b6' }, itemStyle: { color: '#4d76b6' } },
        { name: t('usageCacheRead'), type: 'line', data: frames.map((frame) => frame.totals.cacheRead ?? 0), showSymbol: false, lineStyle: { width: 1.2, color: '#8870b2' }, areaStyle: { color: theme === 'dark' ? 'rgba(130,103,177,.14)' : 'rgba(130,103,177,.1)' }, itemStyle: { color: '#8870b2' } },
        { name: t('usageCacheWrite'), type: 'line', data: frames.map((frame) => frame.totals.cacheWrite ?? 0), showSymbol: false, lineStyle: { width: 1.2, color: '#4b96a5' }, itemStyle: { color: '#4b96a5' } },
        { name: t('usageUncached'), type: 'line', data: frames.map((frame) => Math.max(0, frame.totals.input - (frame.totals.cacheRead ?? 0))), showSymbol: false, lineStyle: { width: 1.2, color: '#3f8d66' }, itemStyle: { color: '#3f8d66' } },
        { name: t('usageOutput'), type: 'line', yAxisIndex: 1, data: frames.map((frame) => frame.totals.output ?? 0), showSymbol: false, lineStyle: { width: 1, type: 'dashed', color: '#bd8a31' }, itemStyle: { color: '#bd8a31' } },
      ],
    };
  }, [frames, t, theme]);
  return <ReactEChartsCore echarts={echarts} option={option} notMerge style={{ height: 280, width: '100%' }} opts={{ renderer: 'canvas' }} />;
}
