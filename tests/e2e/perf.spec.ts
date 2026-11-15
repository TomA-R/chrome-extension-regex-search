import { expect, test } from './harness';
import { bigPage } from './pages';

test.skip(!!process.env.COVERAGE, 'timing budgets are meaningless under coverage instrumentation');

test.beforeEach(async ({ serve }) => serve({ 'a.test/big': bigPage(20000) }));

/** Performance budgets, measured end-to-end (includes the harness polling overhead). */
test('big page (~5.8M chars): budgets for results, re-match, navigation and scrolling', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/big');
  await page.evaluate(() => {
    const w = window as unknown as { longTasks: number[] };
    w.longTasks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  await rx.open();
  const t0 = Date.now();
  await rx.type('dolor');
  await expect.poll(async () => (await rx.state()).total, { intervals: [10] }).toBeGreaterThan(0);
  const firstResults = Date.now() - t0;
  const s = await rx.settle();
  const done = Date.now() - t0;
  expect(s.total).toBeGreaterThan(30000);

  const t1 = Date.now();
  await rx.type('dolore');
  await expect.poll(async () => { const st = await rx.state(); return st.status === 'done' && st.query.pattern === 'dolore'; }, { intervals: [10] }).toBe(true);
  const rematch = Date.now() - t1; // includes the 60ms debounce

  const record = () => page.evaluate(() => {
    const w = window as unknown as { frames: number[]; rec: boolean };
    w.frames = []; w.rec = true;
    let last = performance.now();
    const tick = () => { const now = performance.now(); w.frames.push(now - last); last = now; if (w.rec) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const stop = () => page.evaluate(() => {
    const w = window as unknown as { frames: number[]; rec: boolean };
    w.rec = false;
    const f = w.frames.slice(1).sort((a, b) => a - b);
    return { p50: f[Math.floor(f.length / 2)] ?? 0, p95: f[Math.floor(f.length * 0.95)] ?? 0, n: f.length };
  });
  const lat: number[] = [];
  const start = (await rx.state()).current;
  for (let i = 0; i < 20; i++) {
    const t = Date.now();
    await page.keyboard.press('Enter');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    lat.push(Date.now() - t);
  }
  await expect.poll(async () => (await rx.state()).current).toBe(start + 20);
  lat.sort((a, b) => a - b);
  const nav = { p50: lat[10]!, max: lat[19]! };
  await record();
  await page.evaluate(async () => { for (let i = 0; i < 40; i++) { scrollBy(0, 600); await new Promise(requestAnimationFrame); } });
  const scroll = await stop();
  const reg = await rx.highlightSizes();
  const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
  console.log(JSON.stringify({ firstResults, done, rematch, nav, scroll, registered: reg.all, longTasks }));

  expect(firstResults).toBeLessThan(1000);
  expect(done).toBeLessThan(1500);
  expect(rematch).toBeLessThan(500);
  // Rare ~150ms outliers are native raster in headless mode, not our code.
  expect(nav.p50).toBeLessThan(50);
  expect(nav.max).toBeLessThan(300);
  expect(scroll.p95).toBeLessThan(34);
  expect(reg.all).toBeLessThan(5000);
  expect(Math.max(0, ...longTasks)).toBeLessThan(150); // one-off style computation only
});
