import { buildModel, expect, load, test } from './harness';

const CASES: [string, string, string][] = [
  ['inline formatting joins', '<p>The <b>quick</b> <i>brown</i> fox</p>', 'The quick brown fox'],
  ['blocks separate with \\n', '<p>one</p><p>two</p><div>three</div>', 'one\ntwo\nthree'],
  ['whitespace collapses like CSS', '<p>  a \n\t  b  </p>', 'a b '],
  ['pre keeps whitespace', '<pre>a  b\n  c</pre>', 'a  b\n  c'],
  ['inline child can override white-space', '<p>a  b <span style="white-space:pre">x  y</span>  c</p>', 'a b x  y c'],
  ['pre-line keeps newlines, collapses spaces', '<p style="white-space:pre-line">a   b\n   c</p>', 'a b\nc'],
  ['br is a newline', '<p>a<br>b</p>', 'a\nb'],
  ['table cells use tabs, rows newlines', '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>', 'a\tb\nc\td'],
  ['inline-block is a word boundary', '<p>x<span style="display:inline-block">y</span>z</p>', 'x y z'],
  ['display:none skipped', '<p>a<span style="display:none">HIDDEN</span>b</p>', 'ab'],
  ['visibility:hidden skipped, visible child kept', '<p style="visibility:hidden">h<span style="visibility:visible">v</span></p>', 'v'],
  ['script/style/template skipped', '<p>a</p><script>var x</script><style>p{}</style><template><p>t</p></template><p>b</p>', 'a\nb'],
  ['closed details content is searchable', '<details><summary>S</summary><p>inside</p></details>', 'S\ninside'],
  ['until-found is searchable', '<div hidden="until-found">found</div>', 'found'],
  ['hidden attribute is not', '<div hidden>gone</div><p>x</p>', 'x'],
  ['list items separate', '<ul><li>a</li><li>b</li></ul>', 'a\nb'],
  ['fields are their own segment', '<p>t</p><input value="iv"><textarea>tv</textarea>', 't\niv\ntv\n'],
  ['password fields are never indexed', '<input type="password" value="secret"><p>x</p>', 'x'],
];

for (const [name, html, expected] of CASES) {
  test(`text model: ${name}`, async ({ page }) => {
    await load(page, `<!doctype html><body>${html}</body>`);
    expect((await buildModel(page)).text).toBe(expected);
  });
}

test('shadow DOM: flat tree order with slots, unslotted content skipped', async ({ page }) => {
  await load(page, `<!doctype html><body><p>before</p><x-host><span>slotted</span></x-host><p>after</p>
    <script>customElements.define('x-host', class extends HTMLElement { constructor() { super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<div>[<slot></slot>]</div><p hidden>nope</p>'; } });</script></body>`);
  expect((await buildModel(page)).text).toBe('before\n[slotted]\nafter');
});

test('every match maps back to the exact DOM text (round-trip over a mixed page)', async ({ page }) => {
  let html = '<!doctype html><body>';
  for (let i = 0; i < 200; i++) html += `<p>Item ${i}: <b>bold  ${i}</b>\n  <a href=#>link</a> &amp; <code>c${i}</code> <span style="display:inline-block">ib${i}</span></p><pre>pre ${i}\n  x</pre>`;
  await load(page, html + '</body>');
  const bad = await page.evaluate(async () => {
    const { DomTextSource } = (window as any).__rx;
    const m = await new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: new AbortController().signal });
    const norm = (s: string) => s.replace(/\s+/g, ' ');
    const failures: string[] = [];
    for (const x of m.text.matchAll(/[^\s]+(?: [^\s]+)?/g)) {
      const loc = m.locate(x.index, x.index + x[0].length);
      if (!loc || loc.kind !== 'text') { failures.push(`unmapped ${x[0]}`); continue; }
      const r = new Range(); r.setStart(loc.startNode, loc.startOffset); r.setEnd(loc.endNode, loc.endOffset);
      if (norm(r.toString()) !== norm(x[0])) failures.push(`${JSON.stringify(x[0])} -> ${JSON.stringify(r.toString())}`);
    }
    return failures.slice(0, 5);
  });
  expect(bad).toEqual([]);
});

test('matches innerText (modulo whitespace) on a realistic page', async ({ page }) => {
  let html = '<!doctype html><body><nav><ul><li><a href=#>Home</a></li><li><a href=#>Docs</a></li></ul></nav><main>';
  for (let i = 0; i < 50; i++) html += `<h2>Section ${i}</h2><p>Para <em>${i}</em> text, see <a href=#>ref</a>.</p><table><tr><th>k</th><td>v${i}</td></tr></table><ul><li>one</li><li>two</li></ul>`;
  await load(page, html + '</main></body>');
  const { text } = await buildModel(page);
  const inner = await page.evaluate(() => document.body.innerText);
  const norm = (s: string) => s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  expect(norm(text)).toEqual(norm(inner));
});

test('time-slicing: yields to the main thread on big pages and can be aborted', async ({ page }) => {
  await load(page, `<!doctype html><body>${'<p>lorem ipsum <b>dolor</b> sit amet</p>'.repeat(30000)}</body>`);
  const r = await page.evaluate(async () => {
    const { DomTextSource } = (window as any).__rx;
    let slices = 0, maxGap = 0, last = performance.now();
    const ac = new AbortController();
    const m = await new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: ac.signal, sliceMs: 8,
      onSlice: () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); slices++; last = now; } });
    const ac2 = new AbortController();
    const p = new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: ac2.signal, sliceMs: 8 });
    ac2.abort();
    const aborted = await p.then(() => false, (e: Error) => e.name === 'AbortError');
    return { slices, maxGap, len: m.text.length, aborted };
  });
  expect(r.slices).toBeGreaterThan(5);
  expect(r.maxGap).toBeLessThan(60); // includes the one-off first style computation
  expect(r.aborted).toBe(true);
});
