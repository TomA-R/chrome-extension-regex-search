import { expect, load, test } from './harness';

const PAGE = `<!doctype html><body>
<h1>Title  text</h1>
<p>Lorem <b>ipsum</b>  dolor <a href=#>sit</a> amet.</p>
<p>  leading and trailing   </p>
<pre>pre  text
  kept</pre>
<p style="white-space:pre-line">line one
   line   two</p>
<table><tr><td>a</td><td>b</td></tr></table>
<ul><li>one</li><li>two <span style="display:inline-block">ib</span> three</li></ul>
<input id=f value="field value"><textarea id=t>area text</textarea>
<p>tail <i>end</i></p>
</body>`;

for (const seed0 of [3, 7, 11, 19, 23, 42]) test(`rebuild() after text-only mutations equals a fresh walk (randomized, seed ${seed0})`, async ({ page }) => {
  await load(page, PAGE);
  const result = await page.evaluate(async (seedIn) => {
    const { DomTextSource } = (window as any).__rx;
    const src = new DomTextSource();
    const build = () => src.build({ searchFields: true, exclude: new Set(), signal: new AbortController().signal });
    const texts: Text[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) texts.push(n as Text);
    const values = ['x', '  spaced  out  ', '\n\nnew\nlines\n', 'two  spaces', ' ', 'longer replacement text', 'end ', ' start'];
    let seed = seedIn;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const failures: string[] = [];
    let model = await build();
    let nulls = 0;
    for (let round = 0; round < 100; round++) {
      const changed = new Set<Node>();
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
        const t = texts[Math.floor(rnd() * texts.length)]!;
        // Only indexed nodes; others need a full walk.
        if (!model.segs.some((s: any) => s.kind === 'text' && s.node === t)) continue;
        t.data = values[Math.floor(rnd() * values.length)]!;
        changed.add(t);
      }
      if (rnd() < 0.3) { const f = document.getElementById('f') as HTMLInputElement; f.value = values[Math.floor(rnd() * values.length)]!; changed.add(f); }
      const patched = await model.rebuild({ changed });
      const fresh = await build();
      if (!patched) { nulls++; model = fresh; continue; } // blanked text: caller falls back to a full walk
      if (patched.text !== fresh.text) { failures.push(`round ${round}: ${JSON.stringify(patched.text)} != ${JSON.stringify(fresh.text)}`); break; }
      for (const x of fresh.text.matchAll(/\S+/g)) {
        const a = patched.locate(x.index, x.index + x[0].length), b = fresh.locate(x.index, x.index + x[0].length);
        if (JSON.stringify([a?.startOffset, a?.endOffset, a?.kind]) !== JSON.stringify([b?.startOffset, b?.endOffset, b?.kind])) { failures.push(`round ${round}: mapping differs for ${x[0]}`); break; }
      }
      model = patched;
    }
    if (nulls > 50) failures.push(`too many fallbacks: ${nulls}/100`);
    return failures;
  }, seed0);
  expect(result).toEqual([]);
});

test('rebuild() refuses when a node was detached (structure changed)', async ({ page }) => {
  await load(page, '<!doctype html><body><p id=a>one</p><p>two</p></body>');
  const r = await page.evaluate(async () => {
    const { DomTextSource } = (window as any).__rx;
    const m = await new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: new AbortController().signal });
    const t = document.getElementById('a')!.firstChild!;
    document.getElementById('a')!.remove();
    return (await m.rebuild({ changed: new Set([t]) })) === null;
  });
  expect(r).toBe(true);
});

test('rebuild() with replaced text nodes (el.textContent = ...) equals a fresh walk', async ({ page }) => {
  await load(page, PAGE);
  const failures = await page.evaluate(async () => {
    const { DomTextSource } = (window as any).__rx;
    const build = () => new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: new AbortController().signal });
    const values = ['x', 'two  words', 'tick 42', 'longer replacement text', ' lead', 'trail '];
    let model = await build();
    const failures: string[] = [];
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 80; round++) {
      const cands = [...document.body.querySelectorAll('*')].filter((el) => el.childNodes.length === 1 && el.firstChild!.nodeType === 3 && model.segs.some((s: any) => s.node === el.firstChild));
      const el = cands[Math.floor(rnd() * cands.length)]!;
      const old = el.firstChild!;
      el.textContent = values[Math.floor(rnd() * values.length)]!;
      const patched = await model.rebuild({ changed: new Set(), replace: new Map([[old, el.firstChild]]) });
      const fresh = await build();
      if (!patched) { model = fresh; continue; }
      if (patched.text !== fresh.text) { failures.push(`round ${round}: ${JSON.stringify(patched.text)} != ${JSON.stringify(fresh.text)}`); break; }
      if (!patched.segs.every((s: any, i: number) => s.kind !== 'text' || s.node === fresh.segs[i].node)) { failures.push(`round ${round}: nodes differ`); break; }
      model = patched;
    }
    return failures;
  });
  expect(failures).toEqual([]);
});
