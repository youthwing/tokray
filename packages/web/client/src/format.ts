export function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

export function fmtBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1000) return `${Math.round(value / 1000)} KB`;
  return `${value} B`;
}

export function fmtDate(value: number, locale?: string): string {
  if (!value) return locale === 'zh-CN' ? '时间未知' : 'Unknown time';
  return new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value);
}
