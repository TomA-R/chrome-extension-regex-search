import { test } from './harness';
test('diff our matches vs innerText on MDN', async ({ rx }) => {
  test.skip(!process.env.REAL, 'set REAL=1');
  test.setTimeout(90_000);
  await rx.page.goto('https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp', { waitUntil: 'load' });
  await rx.open();
  await rx.type('RegExp');
  const s = await rx.settle();
  const { items } = await rx.coord({ t: 'coord.snippets', offset: 0, limit: s.total });
  const inner = await rx.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const missing = items.filter((i) => !inner.includes((i.before.slice(-15) + i.match + i.after.slice(0, 15)).replace(/\s+/g, ' ').trim()));
  console.log(s.total, 'not-in-innerText:', missing.length);
  for (const m of missing.slice(0, 20)) console.log('  …' + JSON.stringify(m.before.slice(-40) + '[' + m.match + ']' + m.after.slice(0, 40)));
});
