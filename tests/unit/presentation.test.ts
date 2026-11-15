import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../../src/core/query';
import type { CoordState } from '../../src/shared/messages';
import { countLabel, OPTION_TOGGLES, replaceSummary, truncationNote } from '../../src/shared/presentation';

const st = (p: Partial<CoordState>): CoordState => ({ open: true, query: { ...DEFAULT_OPTIONS, pattern: 'x' }, status: 'done', total: 0, matched: 0, current: -1, truncated: false, currentEditable: false, frames: 1, ...p });

describe('countLabel', () => {
  it.each([
    [st({ query: { ...DEFAULT_OPTIONS, pattern: '' } }), '', false],
    [st({ status: 'error' }), 'Invalid', true],
    [st({ status: 'timeout' }), 'Too slow', true],
    [st({ status: 'searching' }), '…', false],
    [st({ status: 'indexing' }), 'Indexing…', false],
    [st({}), 'No results', true],
    [st({ total: 1204, matched: 1204, current: 2 }), '3 of 1,204', false],
    [st({ total: 5, matched: 9, current: -1, truncated: true, status: 'indexing' }), '? of 9…', false],
  ])('%#', (s, text, bad) => expect(countLabel(s)).toEqual({ text, bad }));
});

describe('replaceSummary', () => {
  it('reports counts and non-editable skips', () => {
    expect(replaceSummary({ replaced: 3, skipped: 2 })).toBe('Replaced 3 · 2 not editable');
    expect(replaceSummary({ replaced: 0, skipped: 2 })).toBe('Matches aren’t in editable fields');
    expect(replaceSummary(null)).toBe('Replace failed');
  });
});

it('every option toggle has a unique Alt shortcut', () => {
  expect(new Set(OPTION_TOGGLES.map((t) => t.code)).size).toBe(OPTION_TOGGLES.length);
});

it('truncation note names both numbers', () => {
  expect(truncationNote(st({ total: 100000, matched: 470213, truncated: true }))).toBe('Only the first 100,000 of 470,213 matches are highlighted. Refine the pattern to see the rest.');
  expect(truncationNote(st({ total: 3, matched: 3 }))).toBeNull();
});
