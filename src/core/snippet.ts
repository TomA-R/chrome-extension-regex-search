export interface Snippet { before: string; match: string; after: string }

export function snippetAt(text: string, start: number, end: number, before = 24, after = 100): Snippet {
  const flat = (s: string) => s.replace(/[\t ]+/g, ' ');
  const blockStart = text.lastIndexOf('\n', start - 1) + 1;
  let b = text.slice(Math.max(blockStart, start - before), start);
  if (start - before > blockStart) b = '…' + b.replace(/^\S*\s?/, '');
  const nl = text.indexOf('\n', end);
  const blockEnd = nl < 0 ? text.length : nl;
  let a = text.slice(end, Math.min(blockEnd, end + after));
  if (end + after < blockEnd) a = a.replace(/\s?\S*$/, '') + '…';
  const m = text.slice(start, Math.min(end, start + 300));
  return { before: flat(b), match: flat(m.replace(/\n/g, ' ⏎ ')) + (end - start > 300 ? '…' : ''), after: flat(a) };
}
