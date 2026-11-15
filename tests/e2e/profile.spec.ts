import { test } from './harness';
import { bigPage } from './pages';
// Diagnostic: PROFILE=1 npx playwright test profile
test('profile big page search', async ({ rx, serve, context }) => {
  test.skip(!process.env.PROFILE, 'set PROFILE=1 to run');
  await serve({ 'a.test/big': bigPage(20000) });
  await rx.page.goto('https://a.test/big');
  await rx.open();
  const cdp = await context.newCDPSession(rx.page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await rx.type('dolor');
  await rx.settle();
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map<string, number>();
  const dt = profile.timeDeltas!; const ids = profile.samples!;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  ids.forEach((id, i) => { const n = byId.get(id)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000); });
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${v.toFixed(1).padStart(7)}ms ${k}`).join('\n'));
});

test('profile navigation on big page', async ({ rx, serve, context }) => {
  test.skip(!process.env.PROFILE, 'set PROFILE=1 to run');
  await serve({ 'a.test/big': bigPage(20000) });
  await rx.page.goto('https://a.test/big');
  await rx.open();
  await rx.type('dolor');
  await rx.settle();
  const cdp = await context.newCDPSession(rx.page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const lat: number[] = [];
  for (let i = 0; i < 30; i++) { const t = Date.now(); await rx.page.keyboard.press('Enter'); await rx.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); lat.push(Date.now() - t); }
  const { profile } = await cdp.send('Profiler.stop');
  console.log('lat', JSON.stringify(lat));
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples!.forEach((id, i) => { const n = byId.get(id)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000); });
  console.log([...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(1).padStart(7)}ms ${k}`).join('\n'));
});

test('profile live page upkeep', async ({ rx, serve, context }) => {
  test.skip(!process.env.PROFILE, 'set PROFILE=1 to run');
  await serve({ 'a.test/live': bigPage(20000).replace('<div id=root>', '<div id=root><p>clock <span id=clock>0</span> ticks</p>') });
  await rx.page.goto('https://a.test/live');
  await rx.open();
  await rx.type('clock \\d+ ticks|dolor');
  await rx.settle();
  await rx.page.evaluate(() => { let n = 0; const el = document.getElementById('clock')!; window.setInterval(() => { (el.firstChild as Text).data = String(++n); }, 100); });
  await rx.page.waitForTimeout(500);
  const cdp = await context.newCDPSession(rx.page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await rx.page.waitForTimeout(4000);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples!.forEach((id, i) => { const n = byId.get(id)!; const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000); });
  console.log([...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${v.toFixed(1).padStart(7)}ms ${k}`).join('\n'));
});
