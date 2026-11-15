import { expect, test } from './harness';
import { bigPage } from './pages';

test.skip(!!process.env.COVERAGE, 'timing budgets are meaningless under coverage instrumentation');

for (const mode of ['data', 'textContent'] as const) test(`live page (${mode} updates): keeping results fresh costs little main-thread time`, async ({ rx, serve, context }) => {
  await serve({ 'a.test/live': bigPage(20000).replace('<div id=root>', '<div id=root><p>clock <span id=clock>0</span> ticks</p>') });
  const { page } = rx;
  await page.goto('https://a.test/live');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (process.env.CPU_SLOWDOWN) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOWDOWN) });
  const busy = async () => {
    const m = (await cdp.send('Performance.getMetrics')).metrics;
    const v = (k: string) => m.find((x) => x.name === k)?.value ?? 0;
    return v('TaskDuration');
  };
  // 'data': in-place edits (React-style); 'textContent': the text node is replaced.
  await page.evaluate((m) => {
    let n = 0;
    const el = document.getElementById('clock')!;
    window.setInterval(() => { if (m === 'data') (el.firstChild as Text).data = String(++n); else el.textContent = String(++n); }, 100);
  }, mode);
  const sample = async () => { const b0 = await busy(); const t0 = Date.now(); await page.waitForTimeout(4000); return (await busy() - b0) / ((Date.now() - t0) / 1000); };
  await page.waitForTimeout(500);
  const baseline = await sample();
  await rx.open();
  await rx.type('clock \\d+ ticks|dolor');
  await rx.settle();
  await page.waitForTimeout(500);
  const withSearch = await sample();
  const lags: number[] = [];
  for (let i = 0; i < 10; i++) {
    const [r, now] = await Promise.all([rx.coord({ t: 'coord.snippets', offset: 0, limit: 1 }), page.evaluate(() => Number(document.getElementById('clock')!.textContent))]);
    const seen = Number(/\d+/.exec(r.items[0]?.match ?? '')?.[0] ?? NaN);
    lags.push(now - seen);
    await page.waitForTimeout(150);
  }
  const lagMs = Math.max(...lags) * 100;
  const clock = await page.evaluate(() => document.getElementById('clock')!.textContent);
  await expect.poll(async () => (await rx.coord({ t: 'coord.snippets', offset: 0, limit: 1 })).items[0]?.match ?? '', { timeout: 5000 }).toMatch(/^clock \d+ ticks$/);
  // A second baseline after closing the bar: averaging both cancels drift (GC, runner load) across the run.
  await rx.coord({ t: 'coord.close' });
  await page.waitForTimeout(500);
  const baselineAfter = await sample();
  const cpu = withSearch - (baseline + baselineAfter) / 2;
  console.log(JSON.stringify({ mode, baseline: +baseline.toFixed(3), withSearch: +withSearch.toFixed(3), baselineAfter: +baselineAfter.toFixed(3), overhead: +cpu.toFixed(3), maxLagMs: lagMs, clock }));
  // Design budget is ~10%. Shared CI runners are too noisy for that precision, so CI only guards against
  // real regressions (a full re-walk per tick costs ~30%).
  expect(cpu).toBeLessThan(process.env.CI ? 0.2 : 0.13);
  expect(lagMs).toBeLessThan(1500);
});
