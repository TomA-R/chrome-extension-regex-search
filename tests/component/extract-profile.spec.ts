import { test } from '@playwright/test';
import { BUNDLE } from './harness';

// Diagnostic (network): REAL=1 npx playwright test --project=component extract-profile
test.use({ bypassCSP: true });
test('profile DomTextSource on the WHATWG single-page spec', async ({ page, context }) => {
  test.skip(!process.env.REAL, 'set REAL=1');
  test.setTimeout(180_000);
  await page.goto('https://html.spec.whatwg.org/', { waitUntil: 'load', timeout: 120_000 });
  await page.addScriptTag({ path: BUNDLE });
  const run = () => page.evaluate(async () => {
    const { DomTextSource } = (window as any).__rx;
    const t0 = performance.now();
    let slices = 0;
    const m = await new DomTextSource().build({ searchFields: true, exclude: new Set(), signal: new AbortController().signal, onSlice: () => slices++ });
    return { ms: Math.round(performance.now() - t0), chars: m.text.length, segs: m.segs.length, slices };
  });
  console.log('warmup', JSON.stringify(await run()));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const r = await run();
  const { profile } = await cdp.send('Profiler.stop');
  console.log('measured', JSON.stringify(r));
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples!.forEach((id, i) => { const n = byId.get(id)!; const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000); });
  console.log([...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v.toFixed(1).padStart(7)}ms ${k}`).join('\n'));
});
