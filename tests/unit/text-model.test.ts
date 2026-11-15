import { describe, expect, it } from 'vitest';
import { TextModel } from '../../src/core/text-model';

type N = { id: string; data: string };
const node = (id: string, data: string): N => ({ id, data });

describe('TextModel', () => {
  it('joins text, collapses repeated separators, and locates cross-node matches', () => {
    const m = new TextModel<N, string, string>();
    const a = node('a', 'foo '), b = node('b', 'bar');
    m.appendText(a, a.data, null, 'p1');
    m.appendText(b, b.data, null, 'p1');
    m.separator('\n'); m.separator('\n'); m.separator(' ');
    const c = node('c', 'baz');
    m.appendText(c, c.data, null, 'p2');
    expect(m.text).toBe('foo bar\nbaz');
    const loc = m.locate(2, 6);
    expect(loc).toMatchObject({ kind: 'text', startNode: a, startOffset: 2, endNode: b, endOffset: 2 });
  });

  it('trims separators at match edges and returns null for separator-only matches', () => {
    const m = new TextModel<N, string, string>();
    m.appendText(node('a', 'x'), 'x', null, 'p');
    m.separator('\n');
    m.appendText(node('b', 'y'), 'y', null, 'q');
    expect(m.text).toBe('x\ny');
    expect(m.locate(1, 2)).toBeNull();
    expect(m.locate(1, 3)).toMatchObject({ startOffset: 0, endOffset: 1 });
  });

  it('maps collapsed whitespace back to raw offsets', () => {
    const m = new TextModel<N, string, string>();
    const raw = 'a  \n b';
    // model "a b": raw indices of model chars: a=0, ' '=1 (first ws), b=5; plus end=6
    m.appendText(node('a', raw), 'a b', Int32Array.from([0, 1, 5, 6]), 'p');
    expect(m.locate(1, 3)).toMatchObject({ startOffset: 1, endOffset: 6 });
    expect(m.offsetOfNode(m.segs[0]!.kind === 'text' ? m.segs[0]!.node : null as never, 5)).toBe(2);
  });

  it('keeps field values separate and clips matches at field boundaries', () => {
    const m = new TextModel<N, string, string>();
    m.appendText(node('a', 'hello'), 'hello', null, 'p');
    m.appendField('input#1', 'world');
    m.appendText(node('b', 'tail'), 'tail', null, 'p');
    expect(m.text).toBe('hello\nworld\ntail');
    expect(m.locate(6, 11)).toEqual({ kind: 'field', seg: 1, el: 'input#1', start: 0, end: 5 });
    expect(m.locate(0, 11)).toMatchObject({ kind: 'text', endOffset: 5 });
  });

});

describe('TextModel trailing whitespace', () => {
  it('drops a collapsible trailing space before a block break (so ^foo$ works), keeping offsets mapped', () => {
    const m = new TextModel<N, string, string>();
    const a = node('a', 'foo\n  ');
    m.appendText(a, 'foo ', Int32Array.from([0, 1, 2, 3, 6]), 'p', true);
    m.separator('\n');
    m.appendText(node('b', 'bar'), 'bar', null, 'q', true);
    expect(m.text).toBe('foo\nbar');
    expect([...'foo\nbar'.matchAll(/^\w+$/gm)].map((x) => x[0])).toEqual(['foo', 'bar']);
    expect(m.locate(0, 3)).toMatchObject({ startNode: a, startOffset: 0, endOffset: 3 });
  });

  it('keeps the space before an inline separator and in pre-formatted text', () => {
    const m = new TextModel<N, string, string>();
    m.appendText(node('a', 'x '), 'x ', null, 'p', false);
    m.separator('\n');
    m.appendText(node('b', 'y '), 'y ', null, 'q', true);
    m.separator(' ');
    m.appendText(node('c', 'z'), 'z', null, 'r', true);
    expect(m.text).toBe('x \ny z');
  });

  it('tracks whether any field segment exists', () => {
    const m = new TextModel<N, string, string>();
    m.appendText(node('a', 'x'), 'x', null, 'p');
    expect(m.hasFields).toBe(false);
    m.appendField('f', 'v');
    expect(m.hasFields).toBe(true);
  });
});

describe('whitespace collapsing', () => {
  it('the fast path and the mapped path always agree (randomized)', async () => {
    const { collapse, collapseWithMap } = await import('../../src/core/whitespace');
    const alphabet = ['a', 'b', ' ', '  ', '\n', '\t', '\r\n', 'é', '😀'];
    let seed = 42;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 2000; n++) {
      let raw = '';
      for (let k = Math.floor(rnd() * 12); k > 0; k--) raw += alphabet[Math.floor(rnd() * alphabet.length)];
      for (const keepNl of [false, true]) for (const prevWs of [false, true]) {
        const fast = collapse(raw, keepNl, prevWs);
        const slow = collapseWithMap(raw, keepNl, prevWs);
        expect(fast, JSON.stringify({ raw, keepNl, prevWs })).toBe(slow.text);
        expect(slow.map.length).toBe(slow.text.length + 1);
        for (let i = 0; i < slow.text.length; i++) {
          const o = slow.text[i]!, r = raw[slow.map[i]!]!;
          expect(o === r || (/\s/.test(o) && /\s/.test(r))).toBe(true);
        }
      }
    }
  });

  it('builds collapse maps lazily, only for segments that are located', async () => {
    const { collapse } = await import('../../src/core/whitespace');
    const raw = 'foo \n   bar';
    const m = new TextModel<{ data: string }, string, string>({ rawText: (n) => n.data });
    const nodeA = { data: raw };
    m.appendText(nodeA, collapse(raw, false, true), null, 'p', true, { keepNl: false, prevWs: true });
    expect(m.text).toBe('foo bar');
    expect(m.segs[0]!.kind === 'text' && m.segs[0]!.map).toBe(null);
    expect(m.locate(4, 7)).toMatchObject({ startOffset: 8, endOffset: 11 });
    expect(m.segs[0]!.kind === 'text' && m.segs[0]!.map).not.toBe(null);
  });
});
