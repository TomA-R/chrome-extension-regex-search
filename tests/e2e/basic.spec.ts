import { expect, test } from './harness';

const BASIC = `<!doctype html><html><body>
<h1>Title</h1>
<p id=p1>The <b>quick</b> brown fox jumps over the <i>lazy</i> dog.</p>
<p id=p2>Second paragraph mentions fox again; contact bob@example.com or alice@example.org.</p>
<p>end of one</p><p>block start</p>
<p style="display:none">hidden fox in display none</p>
<p><span style="visibility:hidden">invisible fox</span></p>
<details id=det><summary>More</summary><p>fox inside closed details</p></details>
<div id=uf hidden="until-found">fox until found</div>
<div style="height:3000px"></div>
<p id=far>far away fox at the bottom</p>
<div style="height:600px"></div><p id=edge>edge fox</p><div style="height:2000px"></div>
</body></html>`;

test.beforeEach(async ({ serve }) => serve({ 'a.test/basic': BASIC }));

test('finds, counts and highlights matches; text across inline elements; not across blocks', async ({ rx }) => {
  await rx.page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('quick brown');
  let s = await rx.settle();
  expect(s.total).toBe(1);
  expect(await rx.currentText()).toBe('quick brown');

  await rx.type('one block');
  s = await rx.settle();
  expect(s.total).toBe(0); // separate <p>s are separated by \n

  await rx.type('one\\nblock');
  s = await rx.settle();
  expect(s.total).toBe(1);
});

test('visibility: skips display:none and visibility:hidden, includes revealable content', async ({ rx }) => {
  await rx.page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('fox');
  const s = await rx.settle();
  expect(s.total).toBe(6);
  expect((await rx.highlightSizes()).all).toBe(4); // far/edge are outside the +-1 viewport window
});

test('navigation scrolls a match that is only partially visible at the viewport edge', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('edge fox');
  await rx.settle();
  await page.evaluate(() => { const r = document.getElementById('edge')!.getBoundingClientRect(); scrollBy(0, r.top - innerHeight + 8); });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => { const r = document.getElementById('edge')!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight - 20; })).toBe(true);
});

test('navigation: next/prev wrap around, reveal closed details and until-found, scroll into view', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('fox');
  await rx.settle();
  expect((await rx.state()).current).toBe(0);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await rx.state()).current).toBe(2);
  await expect.poll(() => page.evaluate(() => (document.getElementById('det') as HTMLDetailsElement).open)).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.getElementById('uf')!.hasAttribute('hidden'))).toBe(false);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await rx.state()).current).toBe(4);
  await expect.poll(() => page.evaluate(() => { const r = document.getElementById('far')!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await rx.state()).current).toBe(5);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await rx.state()).current).toBe(0);
  await page.keyboard.press('Shift+Enter');
  await expect.poll(async () => (await rx.state()).current).toBe(5);
});

test('regex errors are reported and keep previous results; Esc closes and clears', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('\\w+@\\w+\\.(com|org)');
  expect((await rx.settle()).total).toBe(2);
  await page.keyboard.type('(');
  const s = await rx.settle();
  expect(s.status).toBe('error');
  expect(s.error).toBeTruthy();
  expect((await rx.highlightSizes()).all).toBe(2);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('rx-find-bar'))).toBe(false);
  expect((await rx.highlightSizes()).all).toBe(0);
});

test('toggles: case, whole word, literal', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/basic');
  await rx.open();
  await rx.type('The');
  expect((await rx.settle()).total).toBe(3); // The quick / the lazy / at the bottom
  await page.keyboard.press('Alt+KeyC');
  await expect.poll(async () => (await rx.state()).query.caseSensitive).toBe(true);
  expect((await rx.settle()).total).toBe(1);
  await page.keyboard.press('Alt+KeyC');
  await rx.type('o');
  const loose = (await rx.settle()).total;
  await page.keyboard.press('Alt+KeyW');
  await expect.poll(async () => (await rx.state()).query.wholeWord).toBe(true);
  expect((await rx.settle()).total).toBe(0);
  expect(loose).toBeGreaterThan(10);
  await page.keyboard.press('Alt+KeyW');
  await page.keyboard.press('Alt+KeyR');
  await rx.type('bob@example.com');
  expect((await rx.settle()).total).toBe(1);
  await rx.type('.');
  expect((await rx.settle()).total).toBe(4); // literal dots only: dog. example.com example.org.
});
