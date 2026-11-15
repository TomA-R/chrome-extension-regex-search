import { describe, expect, it } from 'vitest';
import { diffRange } from '../../src/content/frame/matcher-client';

const apply = (a: string, d: { start: number; end: number; insert: string }) => a.slice(0, d.start) + d.insert + a.slice(d.end);

describe('diffRange', () => {
  it('finds the single changed region (randomized, incl. > 4 KB chunks)', () => {
    let seed = 9;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const word = () => 'abcdefgh'.slice(0, 1 + Math.floor(rnd() * 8));
    for (let n = 0; n < 500; n++) {
      let a = '';
      const len = rnd() < 0.2 ? 20000 : 50;
      while (a.length < len) a += word();
      const i = Math.floor(rnd() * a.length), j = i + Math.floor(rnd() * Math.min(20, a.length - i));
      const b = a.slice(0, i) + (rnd() < 0.5 ? word() : '') + a.slice(j);
      const d = diffRange(a, b);
      expect(apply(a, d)).toBe(b);
      expect(d.end - d.start + d.insert.length).toBeLessThanOrEqual((j - i) + 8 + 1);
    }
  });
  it('identical, append and prefix cases', () => {
    expect(diffRange('abc', 'abc')).toEqual({ start: 3, end: 3, insert: '' });
    expect(diffRange('abc', 'abcdef')).toEqual({ start: 3, end: 3, insert: 'def' });
    expect(apply('hello world', diffRange('hello world', 'hello brave world'))).toBe('hello brave world');
  });
});
