import { expect, test } from './harness';

const page = (extraHead = '') => `<!doctype html><html><head>${extraHead}</head><body>
<p>alpha beta gamma alpha</p><p>search here: alpha</p></body></html>`;

const STEALER = `<script>
  window.seen = [];
  addEventListener('keydown', (e) => { seen.push(e.key); if (e.key === '/' || e.key === 's') e.preventDefault(); }, true);
  document.addEventListener('focusin', (e) => { window.focusStolen = (window.focusStolen||0) + 1; });
</script>`;

test.beforeEach(async ({ serve }) => serve({
  'a.test/stealer': page(STEALER),
  'a.test/csp': { body: page(), headers: { 'content-security-policy': "default-src 'none'; style-src 'none'; script-src 'none'; frame-src 'none'; worker-src 'none'" } },
  'a.test/coep': { body: page(), headers: { 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-opener-policy': 'same-origin' } },
  'a.test/sandbox': { body: page(), headers: { 'content-security-policy': 'sandbox allow-scripts' } },
  // A framework resetting global state once (e.g. on route change), some time after our search.
  'a.test/clearer': page('<script>setTimeout(() => { CSS.highlights.clear(); document.adoptedStyleSheets = []; window.cleared = true; }, 500)</script>'),
  'a.test/slow': page(`<p>${'a'.repeat(40)}b</p>`),
}));

test('page keyboard shortcuts and focus listeners never see keystrokes typed into the bar', async ({ rx }) => {
  await rx.page.goto('https://a.test/stealer');
  await rx.open();
  await rx.type('s/alpha|s');
  await rx.settle();
  expect((await rx.state()).query.pattern).toBe('s/alpha|s');
  expect(await rx.page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
});

for (const name of ['csp', 'coep', 'sandbox']) {
  test(`works on hostile page: ${name}`, async ({ rx }) => {
    await rx.page.goto(`https://a.test/${name}`);
    await rx.open();
    await rx.type('alpha');
    const s = await rx.settle();
    expect(s.total).toBe(3);
    expect((await rx.highlightSizes()).all).toBe(3);
    // style-src CSP must not strip the bar's styles
    expect(await rx.page.evaluate(() => { const h = document.querySelector('rx-find-bar')!; const r = h.getBoundingClientRect(); return [getComputedStyle(h).position, r.top < 40 && r.right > innerWidth - 60]; })).toEqual(['fixed', true]);
  });
}

test('re-asserts highlights by itself after the page clears CSS.highlights and adoptedStyleSheets', async ({ rx }) => {
  await rx.page.goto('https://a.test/clearer');
  await rx.open();
  await rx.type('alpha');
  await rx.settle();
  await expect.poll(() => rx.page.evaluate(() => (window as unknown as { cleared?: boolean }).cleared)).toBe(true);
  await expect.poll(async () => (await rx.highlightSizes()).all, { timeout: 3000 }).toBe(3);
  await expect.poll(() => rx.page.evaluate(() => document.adoptedStyleSheets.length), { timeout: 3000 }).toBe(1);
});

test('catastrophic backtracking is stopped and the page stays responsive', async ({ rx }) => {
  await rx.page.goto('https://a.test/slow');
  await rx.open();
  const t0 = Date.now();
  await rx.type('^(a+)+$');
  const s = await rx.settle();
  expect(s.status).toBe('timeout');
  expect(Date.now() - t0).toBeLessThan(6000);
  expect(await rx.page.evaluate(() => new Promise<number>((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); }))).toBeLessThan(100);
  await rx.type('alpha');
  expect((await rx.settle()).total).toBe(3);
});
