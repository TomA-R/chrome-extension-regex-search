import { expect, test } from './harness';
import { bigPage } from './pages';

test.skip(!!process.env.COVERAGE, 'timing budgets are meaningless under coverage instrumentation');

test('pathological match counts (cap reached): keystroke-to-results stays fast', async ({ rx, serve }) => {
  await serve({ 'a.test/big': bigPage(20000) });
  await rx.page.goto('https://a.test/big');
  await rx.open();
  await rx.type('dolor');
  await rx.settle();
  const timings: Record<string, number> = {};
  for (const p of ['e', '[aeiou]', '\\w', 'ip']) {
    const t0 = Date.now();
    await rx.type(p);
    await expect.poll(async () => { const s = await rx.state(); return s.status === 'done' && s.query.pattern === p; }, { intervals: [10], timeout: 20_000 }).toBe(true);
    timings[p] = Date.now() - t0;
  }
  const s = await rx.state();
  console.log(JSON.stringify({ timings, total: s.total, truncated: s.truncated }));
  await rx.type('e');
  const e = await rx.settle();
  expect(e.truncated).toBe(true);
  expect(e.total).toBe(100_000); // navigable cap
  expect(e.matched).toBeGreaterThan(400_000);
  void s;
  for (const ms of Object.values(timings)) expect(ms).toBeLessThan(1500);
});
