import { describe, expect, it } from 'vitest';
import { snippetAt } from '../../src/core/snippet';

describe('snippetAt', () => {
  const text = 'First paragraph here.\nThe quick brown fox jumps over the lazy dog near the riverbank today.\nNext block.';
  const at = (word: string, b?: number, a?: number) => { const s = text.indexOf(word); return snippetAt(text, s, s + word.length, b, a); };

  it('stays within the paragraph (no context from neighbouring blocks)', () => {
    expect(at('quick')).toEqual({ before: 'The ', match: 'quick', after: ' brown fox jumps over the lazy dog near the riverbank today.' });
  });
  it('cuts long context at word boundaries with an ellipsis', () => {
    expect(at('lazy', 12, 12)).toEqual({ before: '…over the ', match: 'lazy', after: ' dog near…' });
  });
  it('marks newlines inside multi-line matches', () => {
    const s = text.indexOf('here.');
    expect(snippetAt(text, s, s + 9).match).toBe('here. ⏎ The');
  });
});
