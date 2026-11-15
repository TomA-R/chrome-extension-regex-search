import { describe, expect, it } from 'vitest';
import { compileQuery, DEFAULT_OPTIONS, type Query } from '../../src/core/query';

const q = (pattern: string, o: Partial<Query> = {}): Query => ({ ...DEFAULT_OPTIONS, pattern, ...o });
const run = (query: Query, text: string) => {
  const c = compileQuery(query);
  if (c.kind !== 'ok') throw new Error(JSON.stringify(c));
  return [...text.matchAll(new RegExp(c.source, c.flags))].map((m) => m[0]);
};

describe('compileQuery', () => {
  it('empty pattern', () => expect(compileQuery(q('')).kind).toBe('empty'));
  it('case-insensitive by default, multiline always', () => {
    expect(run(q('^foo'), 'Foo\nfoo bar\nxfoo')).toEqual(['Foo', 'foo']);
  });
  it('case sensitive', () => expect(run(q('foo', { caseSensitive: true }), 'Foo foo')).toEqual(['foo']));
  it('literal mode escapes metacharacters', () => expect(run(q('a.b(c)', { regex: false }), 'a.b(c) axb(c)')).toEqual(['a.b(c)']));
  it('whole word is unicode aware', () => {
    expect(run(q('café', { wholeWord: true }), 'café cafés xcafé café!')).toEqual(['café', 'café']);
  });
  it('whole word with alternation groups the body', () => expect(run(q('a|b', { wholeWord: true }), 'a ab b')).toEqual(['a', 'b']));
  it('dotAll', () => {
    expect(run(q('a.b'), 'a\nb')).toEqual([]);
    expect(run(q('a.b', { dotAll: true }), 'a\nb')).toEqual(['a\nb']);
  });
  it('prefers unicode mode (\\p{..})', () => expect(run(q('\\p{Lu}+', { caseSensitive: true }), 'abc DEF ÄÖ')).toEqual(['DEF', 'ÄÖ']));
  it('falls back to legacy mode for patterns only valid without u', () => {
    const c = compileQuery(q('\\-x'));
    expect(c.kind).toBe('ok');
    expect(c.kind === 'ok' && c.flags.includes('u')).toBe(false);
  });
  it('lookbehind and named groups work', () => expect(run(q('(?<=\\$)(?<n>\\d+)'), '$12 and 34')).toEqual(['12']));
  it('reports friendly errors', () => {
    const c = compileQuery(q('(foo'));
    expect(c.kind).toBe('error');
    expect(c.kind === 'error' && c.message).toMatch(/Unterminated group/);
    expect(c.kind === 'error' && c.message).not.toMatch(/Invalid regular expression/);
  });
});
