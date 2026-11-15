import type { SearchOptions } from '../core/query';
import type { CoordState } from './messages';

export const OPTION_TOGGLES: readonly { key: keyof SearchOptions; label: string; title: string; code: string }[] = [
  { key: 'regex', label: '.*', title: 'Regular expression', code: 'KeyR' },
  { key: 'caseSensitive', label: 'Aa', title: 'Match case', code: 'KeyC' },
  { key: 'wholeWord', label: 'ab', title: 'Whole word', code: 'KeyW' },
  { key: 'dotAll', label: '.↵', title: 'Dot matches newline', code: 'KeyS' },
];

const fmt = (n: number) => n.toLocaleString();

export function countLabel(s: CoordState): { text: string; bad: boolean } {
  if (!s.query.pattern) return { text: '', bad: false };
  if (s.status === 'error') return { text: 'Invalid', bad: true };
  if (s.status === 'timeout') return { text: 'Too slow', bad: true };
  if (s.status === 'searching' && !s.total) return { text: '…', bad: false };
  if (!s.total) return s.status === 'indexing' ? { text: 'Indexing…', bad: false } : { text: 'No results', bad: true };
  const pending = s.status === 'indexing' ? '…' : '';
  return { text: `${s.current >= 0 ? fmt(s.current + 1) : '?'} of ${fmt(Math.max(s.matched, s.total))}${pending}`, bad: false };
}

export function truncationNote(s: CoordState): string | null {
  return s.truncated && s.status === 'done' ? `Only the first ${fmt(s.total)} of ${fmt(s.matched)} matches are highlighted. Refine the pattern to see the rest.` : null;
}

export function replaceSummary(r: { replaced: number; skipped: number } | null): string {
  if (!r) return 'Replace failed';
  if (r.replaced) return `Replaced ${fmt(r.replaced)}${r.skipped ? ` · ${fmt(r.skipped)} not editable` : ''}`;
  return r.skipped ? 'Matches aren’t in editable fields' : 'Nothing replaced';
}
