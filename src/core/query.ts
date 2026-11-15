export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  dotAll: boolean;
}

export interface Query extends SearchOptions {
  pattern: string;
}

export const DEFAULT_OPTIONS: SearchOptions = { regex: true, caseSensitive: false, wholeWord: false, dotAll: false };

export type CompiledQuery =
  | { kind: 'ok'; source: string; flags: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

// Not RegExp.escape: it escapes a leading letter as \xNN.
export const escapeLiteral = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

export function friendlyRegexError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '').replace(/^Invalid regular expression: /, '');
}

// Prefers the u flag; falls back for patterns only valid without it (e.g. `\-`).
export function compileQuery(q: Query): CompiledQuery {
  if (q.pattern === '') return { kind: 'empty' };
  const body = q.regex ? q.pattern : escapeLiteral(q.pattern);
  const base = 'gm' + (q.caseSensitive ? '' : 'i') + (q.dotAll ? 's' : '');

  const attempt = (unicode: boolean): CompiledQuery => {
    const wrapped = !q.wholeWord
      ? body
      : unicode
        ? `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`
        : `\\b(?:${body})\\b`;
    const flags = base + (unicode ? 'u' : '');
    try {
      new RegExp(wrapped, flags);
      return { kind: 'ok', source: wrapped, flags };
    } catch (e) {
      return { kind: 'error', message: friendlyRegexError(e) };
    }
  };

  const u = attempt(true);
  if (u.kind === 'ok') return u;
  const legacy = attempt(false);
  return legacy.kind === 'ok' ? legacy : u;
}

export function sameQuery(a: Query | null, b: Query | null): boolean {
  return !!a && !!b && a.pattern === b.pattern && a.regex === b.regex && a.caseSensitive === b.caseSensitive && a.wholeWord === b.wholeWord && a.dotAll === b.dotAll;
}
