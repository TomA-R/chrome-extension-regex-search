import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/shared/settings';

describe('sanitizeSettings', () => {
  it('fills defaults for missing/garbage input', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
  });
  it('rejects colours that could inject CSS', () => {
    const s = sanitizeSettings({ matchColor: 'red}body{display:none', currentColor: '#ABCDEF' });
    expect(s.matchColor).toBe(DEFAULT_SETTINGS.matchColor);
    expect(s.currentColor).toBe('#ABCDEF');
  });
  it('clamps numeric limits and type-checks booleans', () => {
    const s = sanitizeSettings({ maxMatches: 1e12, timeoutMs: -5, debounceMs: 'x', searchFields: 'yes', defaults: { caseSensitive: true, regex: 1 } });
    expect(s).toMatchObject({ maxMatches: 1_000_000, timeoutMs: 100, debounceMs: DEFAULT_SETTINGS.debounceMs, searchFields: true });
    expect(s.defaults).toEqual({ ...DEFAULT_SETTINGS.defaults, caseSensitive: true });
  });
});
