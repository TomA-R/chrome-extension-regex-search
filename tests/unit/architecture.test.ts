import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
});
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)]
  .map((m) => m[1]!).filter((s) => s.startsWith('.'))
  .map((s) => rel(path.resolve(path.dirname(file), s)));

// Rules apply to code, not comments.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const all = files(SRC).map((f) => ({ file: rel(f), imports: imports(f), text: stripComments(readFileSync(f, 'utf8')) }));

describe('architecture', () => {
  it('core/ is pure: imports only core/, uses no chrome.* or DOM globals', () => {
    for (const f of all.filter((x) => x.file.startsWith('core/'))) {
      expect(f.imports.every((i) => i.startsWith('core/')), f.file).toBe(true);
      expect(/\bchrome\.|\bdocument\.|\bwindow\./.test(f.text), f.file).toBe(false);
    }
  });

  it('matcher/ (offscreen side) never imports content code', () => {
    for (const f of all.filter((x) => x.file.startsWith('matcher/'))) expect(f.imports.some((i) => i.startsWith('content/')), f.file).toBe(false);
  });

  it('frame layer never imports the top-frame layer', () => {
    for (const f of all.filter((x) => x.file.startsWith('content/frame/'))) expect(f.imports.some((i) => i.startsWith('content/top/')), f.file).toBe(false);
  });

  it('the coordinator is pure domain logic: no chrome.*, no storage, no frame internals', () => {
    const c = all.find((x) => x.file === 'content/top/coordinator.ts')!;
    expect(/\bchrome\./.test(c.text)).toBe(false);
    expect(c.imports.filter((i) => !i.startsWith('core/') && !i.startsWith('shared/'))).toEqual([]);
    expect(c.text.includes('pushHistory')).toBe(false);
  });

  it('only entrypoints wire runtimes together', () => {
    for (const f of all.filter((x) => !x.file.startsWith('entrypoints/'))) expect(f.imports.some((i) => i.startsWith('entrypoints/')), f.file).toBe(false);
  });
});
