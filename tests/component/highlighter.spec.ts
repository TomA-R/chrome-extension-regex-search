import type { Page } from '@playwright/test';
import { expect, load, test } from './harness';

function layoutPage(): string {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
  const para = (n = 30) => Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ');
  let h = `<!doctype html><style>body{margin:0;font:14px/1.4 sans-serif}header{position:sticky;top:0;background:#eef;z-index:2}
    .badge{position:fixed;right:8px;bottom:8px;width:200px;background:#fee}.inner{height:400px;overflow:auto;margin:8px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr)}.grid>div:nth-child(odd){order:2}.cols{columns:3}pre{white-space:pre-wrap}</style>
    <header>sticky dolor header</header><div class=badge>fixed dolor</div><section id=flow>`;
  for (let i = 0; i < 300; i++) h += `<p>${para()}</p>`;
  h += '</section><div class=inner id=inner>'; for (let i = 0; i < 400; i++) h += `<p>${para()}</p>`;
  h += '</div><div class=grid id=grid>'; for (let i = 0; i < 200; i++) h += `<div>${para(15)}</div>`;
  h += '</div><div class=cols id=cols>'; for (let i = 0; i < 200; i++) h += `<p>${para(20)}</p>`;
  h += '</div><pre id=pre>'; for (let i = 0; i < 800; i++) h += para(10) + '\n'; h += '</pre>';
  return h;
}

test.beforeEach(async ({ page }) => {
  await load(page, layoutPage());
  await page.evaluate(async () => {
    const { DomTextSource, Highlighter } = (window as any).__rx;
    const model = await new DomTextSource().build({ searchFields: false, exclude: new Set(), signal: new AbortController().signal });
    const ranges: number[] = [];
    for (const m of model.text.matchAll(/dolor/g)) ranges.push(m.index, m.index + 5);
    const h = new Highlighter({ all: 'rx-t-all', cur: 'rx-t-cur' }, { match: '#ff0', current: 'orange' });
    h.setMatches(model, ranges);
    await h.whenLaidOut();
    Object.assign(window, { H: h, M: model, R: ranges });
  });
});

/** Ground truth: matches whose rect intersects the viewport and all clipping ancestors, vs registered. */
const missing = (page: Page) => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const { M, R } = window as any;
  const reg = new Set<string>();
  for (const r of CSS.highlights.get('rx-t-all')!) reg.add(`${(r as Range).startContainer.textContent?.length}:${(r as Range).startOffset}:${r.startContainer === (r as Range).endContainer}`);
  const regRanges = [...CSS.highlights.get('rx-t-all')!] as Range[];
  let visible = 0, miss = 0;
  for (let i = 0; i < R.length; i += 2) {
    const loc = M.locate(R[i], R[i + 1]);
    const r = new Range(); r.setStart(loc.startNode, loc.startOffset); r.setEnd(loc.endNode, loc.endOffset);
    const b = r.getBoundingClientRect();
    if (!b.width || b.bottom < 0 || b.top > innerHeight) continue;
    let clipped = false;
    for (let a = loc.startNode.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (a !== document.body && a !== document.documentElement && s.overflowY !== 'visible') {
        const c = a.getBoundingClientRect(); if (b.bottom < c.top || b.top > c.bottom) clipped = true;
      }
    }
    if (clipped) continue;
    visible++;
    if (!regRanges.some((x) => x.startContainer === loc.startNode && x.startOffset === loc.startOffset)) miss++;
  }
  return { visible, missing: miss, registered: regRanges.length, total: R.length / 2 };
});

const positions: [string, string][] = [
  ['top', 'scrollTo(0, 0)'],
  ['inner scroller', "document.getElementById('inner').scrollIntoView()"],
  ['inner scrolled', "document.getElementById('inner').scrollIntoView(); document.getElementById('inner').scrollTop = 8000"],
  ['grid with reversed order', "document.getElementById('grid').scrollIntoView()"],
  ['multi-column', "document.getElementById('cols').scrollIntoView()"],
  ['giant pre', "const p = document.getElementById('pre'); scrollTo(0, p.offsetTop + p.offsetHeight / 2)"],
  ['bottom', 'scrollTo(0, document.body.scrollHeight)'],
];

for (const [name, script] of positions) {
  test(`windowing: every visible match is highlighted (${name}), and only a window is registered`, async ({ page }) => {
    await page.evaluate(script);
    const r = await missing(page);
    expect(r.visible).toBeGreaterThan(0);
    expect(r.missing).toBe(0);
    expect(r.registered).toBeLessThan(r.total / 2);
  });
}

test('current match is highlighted even when outside the window, and tracks DOM edits (live Range)', async ({ page }) => {
  const txt = await page.evaluate(() => {
    const { H, R } = window as any;
    const last = R.length / 2 - 1;
    H.setCurrent(last);
    const r = [...CSS.highlights.get('rx-t-cur')!][0] as Range;
    r.startContainer.parentElement!.insertBefore(document.createTextNode('PREFIX '), r.startContainer);
    (r.startContainer as Text).insertData(0, 'xx ');
    const x = new Range(); x.setStart(r.startContainer, r.startOffset); x.setEnd(r.endContainer, r.endOffset);
    return x.toString();
  });
  expect(txt).toBe('dolor');
});

test('re-asserts registration when the page clears CSS.highlights', async ({ page }) => {
  const sizes = await page.evaluate(() => { CSS.highlights.clear(); (window as any).H.sync(); return CSS.highlights.get('rx-t-all')?.size ?? 0; });
  expect(sizes).toBeGreaterThan(0);
});
