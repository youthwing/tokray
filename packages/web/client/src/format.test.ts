import { describe, expect, it } from 'vitest';
import { fmtBytes, fmtTokens } from './format';

describe('formatters', () => {
  it('formats token scales consistently', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(15000)).toBe('15k');
  });

  it('formats local file sizes', () => {
    expect(fmtBytes(1500)).toBe('2 KB');
    expect(fmtBytes(1_500_000)).toBe('1.5 MB');
  });
});
