import { describe, expect, it } from 'vitest';
import { expandReplacement, replacementAt } from '../../src/core/replace';

describe('expandReplacement', () => {
  const cases: [string, string, string, string][] = [
    ['(\\w+)@(\\w+)', '', 'mail bob@example now', '$2:$1'],
    ['(?<user>\\w+)@(?<host>\\w+)', '', 'bob@example', '$<host>/$<user>'],
    ['b', '', 'abc', '[$&][$$][$`][$\']'],
    ['(a)', '', 'a', '$10$2$1'],
  ];
  it.each(cases)('matches String.prototype.replace for /%s/', (src, flags, input, tpl) => {
    const re = new RegExp(src, flags);
    const m = re.exec(input)!;
    const native = input.replace(new RegExp(src, flags), tpl);
    const ours = input.slice(0, m.index) + expandReplacement(tpl, m, input) + input.slice(m.index + m[0].length);
    expect(ours).toBe(native);
  });
});

describe('replacementAt', () => {
  it('re-executes anchored at the match start, honouring lookbehind context', () => {
    expect(replacementAt('x $12 y', '(?<=\\$)(\\d+)', 'g', 3, '<$1>')).toBe('<12>');
  });
  it('returns null when nothing matches there', () => expect(replacementAt('abc', 'z', 'g', 0, 'x')).toBeNull());
});

describe('expandReplacement edge cases (same as String.prototype.replace)', () => {
  const cases: [string, string, string][] = [
    ['(a)', 'a', '$'],          // lone $ at the end
    ['(a)', 'a', '$0'],         // $0 is literal
    ['(a)', 'a', '$2'],         // group out of range is literal
    ['(a)(b)', 'ab', '$12'],    // two digits out of range, one digit in range
    ['(a)', 'a', '$<x>'],       // named reference without named groups is literal
    ['(?<x>a)', 'a', '$<y>'],   // unknown name -> empty
    ['(?<x>a)', 'a', '$<x'],    // unterminated name
    ['(a)?b', 'b', '[$1]'],     // unmatched group -> empty
  ];
  it.each(cases)('/%s/ on %j with %j', (src, input, tpl) => {
    const m = new RegExp(src).exec(input)!;
    const ours = input.slice(0, m.index) + expandReplacement(tpl, m, input) + input.slice(m.index + m[0].length);
    expect(ours).toBe(input.replace(new RegExp(src), tpl));
  });
});
