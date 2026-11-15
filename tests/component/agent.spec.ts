import { expect, load, test } from './harness';
import type { Page } from '@playwright/test';

async function startAgent(page: Page, pattern: string) {
  await page.evaluate((src) => {
    const { Agent, DomTextSource, InProcessMatcher } = (window as any).__rx;
    const w = window as any;
    w.U = [];
    w.M = new InProcessMatcher();
    w.A = new Agent({
      source: new DomTextSource(), matcher: w.M, exclude: new Set(),
      names: { all: 'rx-a-all', cur: 'rx-a-cur' }, colors: { match: '#ff0', current: 'orange' },
      report: (u: unknown) => w.U.push(u),
    });
    w.spec = { session: 1, source: src, flags: 'gmu', max: 100000, timeoutMs: 1000, searchFields: true };
    w.A.search(w.spec);
  }, pattern);
}
const last = (page: Page) => page.evaluate(() => (window as any).U.at(-1));
const settled = async (page: Page) => {
  await expect.poll(async () => (await last(page))?.status, { timeout: 10_000 }).toBe('done');
  return last(page);
};
const curText = (page: Page) => page.evaluate(() => {
  for (const r of CSS.highlights.get('rx-a-cur') ?? []) { const x = new Range(); x.setStart(r.startContainer, r.startOffset); x.setEnd(r.endContainer, r.endOffset); return x.toString(); }
  return '';
});

test('mutations that happen while indexing are not lost', async ({ page }) => {
  await load(page, `<!doctype html><body>${'<p>filler text <b>here</b></p>'.repeat(20000)}<div id=end></div></body>`);
  await startAgent(page, 'needle');
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'late needle'; document.getElementById('end')!.append(p); });
  await expect.poll(async () => (await last(page))?.count, { timeout: 10_000 }).toBe(1);
});

test('progressive results: the current highlight survives the partial -> final transition', async ({ page }) => {
  await load(page, `<!doctype html><body>${'<p>lorem <b>dolor</b> sit</p>'.repeat(120000)}</body>`);
  await startAgent(page, 'dolor');
  await expect.poll(async () => (await page.evaluate(() => (window as any).U.length)), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).A.goto(1, 0));
  const statuses = await (async () => { await settled(page); return page.evaluate(() => (window as any).U.map((u: any) => u.status)); })();
  expect(statuses).toContain('indexing');
  expect(await curText(page)).toBe('dolor');
});

test('class/style churn re-indexes but does not re-run the regex (text unchanged)', async ({ page }) => {
  await load(page, '<!doctype html><body><p id=p>alpha beta alpha</p></body>');
  await startAgent(page, 'alpha');
  await settled(page);
  const before = await page.evaluate(() => (window as any).M.calls.search);
  await page.evaluate(() => { document.getElementById('p')!.className = 'x'; document.body.style.color = 'red'; });
  await page.waitForTimeout(600); // throttled rebuild
  expect(await page.evaluate(() => (window as any).M.calls.search)).toBe(before);
  expect((await last(page)).count).toBe(2);
});

test('re-index keeps the current match when content is inserted before it', async ({ page }) => {
  await load(page, '<!doctype html><body><div id=feed><p>item 1</p><p>item 2</p><p>item 3</p></div></body>');
  await startAgent(page, 'item \\d');
  await settled(page);
  await page.evaluate(() => (window as any).A.goto(1, 1));
  expect(await curText(page)).toBe('item 2');
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'item 0'; document.getElementById('feed')!.prepend(p); });
  await expect.poll(async () => (await last(page)).count, { timeout: 5000 }).toBe(4);
  expect(await curText(page)).toBe('item 2');
  expect((await last(page)).current).toBe(2);
});

test('replace skips a target that changed while the replacement was computed', async ({ page }) => {
  await load(page, '<!doctype html><body><input id=a value="foo one"><input id=b value="foo two"></body>');
  await startAgent(page, 'foo');
  await settled(page);
  const r = await page.evaluate(() => {
    const w = window as any;
    w.M.delayMs = 50;
    const p = w.A.replace('all', 'bar');
    (document.getElementById('b') as HTMLInputElement).value = 'changed meanwhile';
    return p;
  });
  expect(r).toMatchObject({ replaced: 1, skipped: 1 });
  expect(await page.inputValue('#a')).toBe('bar one');
  expect(await page.inputValue('#b')).toBe('changed meanwhile');
});

test('single replace moves to the next match, even when the replacement still matches', async ({ page }) => {
  await load(page, '<!doctype html><body><textarea id=t>a a a</textarea></body>');
  await startAgent(page, 'a');
  await settled(page);
  await page.evaluate(() => (window as any).A.goto(1, 0));
  const r = await page.evaluate(() => (window as any).A.replace(0, 'aa'));
  expect(await page.inputValue('#t')).toBe('aa a a');
  expect(r.current).toBe(2); // not 0 or 1 (inside the replacement)
});

test('stop clears highlights and releases the matcher', async ({ page }) => {
  await load(page, '<!doctype html><body><p>x y x</p></body>');
  await startAgent(page, 'x');
  await settled(page);
  await page.evaluate(() => (window as any).A.stop());
  expect(await page.evaluate(() => [CSS.highlights.has('rx-a-all'), (window as any).M.calls.dispose])).toEqual([false, 1]);
});

test('updates from a superseded search are never reported', async ({ page }) => {
  await load(page, '<!doctype html><body><p>abc abd</p></body>');
  await page.evaluate(() => {
    const { Agent, DomTextSource, InProcessMatcher } = (window as any).__rx;
    const w = window as any;
    w.U = []; w.M = new InProcessMatcher(); w.M.delayMs = 30;
    w.A = new Agent({ source: new DomTextSource(), matcher: w.M, exclude: new Set(), names: { all: 'rx-a-all', cur: 'rx-a-cur' }, colors: { match: '#ff0', current: 'orange' }, report: (u: unknown) => w.U.push(u) });
    w.A.search({ session: 1, source: 'abc', flags: 'g', max: 100, timeoutMs: 1000, searchFields: true });
    w.A.search({ session: 2, source: 'ab', flags: 'g', max: 100, timeoutMs: 1000, searchFields: true });
  });
  await expect.poll(() => page.evaluate(() => (window as any).U.length)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).U.map((u: any) => [u.session, u.count]))).toEqual([[2, 2]]);
});

test('replace all in a field is a single undo step', async ({ page }) => {
  await load(page, '<!doctype html><body><textarea id=t>a b a b a</textarea></body>');
  await startAgent(page, 'a');
  await settled(page);
  const r = await page.evaluate(() => (window as any).A.replace('all', 'X'));
  expect(r.replaced).toBe(3);
  expect(await page.inputValue('#t')).toBe('X b X b X');
  await page.evaluate(() => { (document.getElementById('t') as HTMLTextAreaElement).focus(); document.execCommand('undo'); });
  expect(await page.inputValue('#t')).toBe('a b a b a');
});

test('adding and removing our own UI hosts never triggers a re-index', async ({ page }) => {
  await load(page, '<!doctype html><body><p>alpha beta</p></body>');
  await startAgent(page, 'alpha');
  await settled(page);
  const before = await page.evaluate(() => (window as any).U.length);
  await page.evaluate(() => {
    for (const tag of ['rx-find-pulse', 'rx-find-overlay', 'rx-find-markers']) {
      const el = document.createElement(tag);
      document.documentElement.append(el);
      el.remove();
    }
  });
  await page.waitForTimeout(700); // past the mutation throttle
  expect(await page.evaluate(() => (window as any).U.length)).toBe(before);
});

test('an indexing failure reports an empty result instead of leaving the UI searching', async ({ page }) => {
  await load(page, '<!doctype html><body><p>alpha</p></body>');
  await page.evaluate(() => {
    const { Agent, InProcessMatcher } = (window as any).__rx;
    const w = window as any;
    w.U = [];
    const broken = { build: () => Promise.reject(new Error('boom')) };
    w.A = new Agent({ source: broken, matcher: new InProcessMatcher(), exclude: new Set(), names: { all: 'rx-a-all', cur: 'rx-a-cur' }, colors: { match: '#ff0', current: 'orange' }, report: (u: unknown) => w.U.push(u) });
    w.A.search({ session: 1, source: 'alpha', flags: 'g', max: 100, timeoutMs: 1000, searchFields: true });
  });
  await expect.poll(() => page.evaluate(() => (window as any).U.at(-1)?.status)).toBe('done');
  expect(await page.evaluate(() => (window as any).U.at(-1).count)).toBe(0);
});
