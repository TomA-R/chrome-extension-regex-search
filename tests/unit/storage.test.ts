import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type Query } from '../../src/core/query';
import { clearHistory, loadHistory, loadSaved, loadSettings, pushHistory, saveSaved, saveSettings, DEFAULT_SETTINGS } from '../../src/shared/settings';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    get: (key: string) => Promise.resolve(key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); return Promise.resolve(); },
  };
}

const q = (pattern: string, o: Partial<Query> = {}): Query => ({ ...DEFAULT_OPTIONS, pattern, ...o });

beforeEach(() => vi.stubGlobal('chrome', { storage: { local: fakeArea(), sync: fakeArea() } }));

describe('history', () => {
  it('is most-recent-first, de-duplicated by pattern and options, and ignores empty patterns', async () => {
    await pushHistory(q('a'));
    await pushHistory(q('b'));
    await pushHistory(q('a'));
    await pushHistory(q('a', { caseSensitive: true }));
    await pushHistory(q(''));
    expect((await loadHistory()).map((x) => [x.pattern, x.caseSensitive])).toEqual([['a', true], ['a', false], ['b', false]]);
  });
  it('keeps at most 50 entries', async () => {
    for (let i = 0; i < 60; i++) await pushHistory(q(`p${i}`));
    const h = await loadHistory();
    expect(h).toHaveLength(50);
    expect(h[0]!.pattern).toBe('p59');
  });
  it('can be cleared', async () => {
    await pushHistory(q('a'));
    await clearHistory();
    expect(await loadHistory()).toEqual([]);
  });
});

describe('settings and saved patterns', () => {
  it('round-trip through storage (settings are sanitized on load)', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, timeoutMs: 999_999 });
    expect((await loadSettings()).timeoutMs).toBe(10_000);
    await saveSaved([{ name: 'emails', query: q('\\w+@\\w+') }]);
    expect(await loadSaved()).toEqual([{ name: 'emails', query: q('\\w+@\\w+') }]);
  });
});
