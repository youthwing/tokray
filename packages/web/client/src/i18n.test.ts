import { describe, expect, it } from 'vitest';
import { translate } from './i18n';

describe('i18n', () => {
  it('translates and interpolates Chinese strings', () => {
    expect(translate('zh-CN', 'calls', { count: 12 })).toBe('12 次调用');
  });

  it('keeps English as a complete fallback resource', () => {
    expect(translate('en', 'showingSessions', { shown: 80, total: 120 })).toBe('Showing 80 of 120');
  });
});
