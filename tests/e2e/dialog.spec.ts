import { expect, test } from './harness';

const PAGE = `<!doctype html><body><p>outside needle</p>
<dialog id=d><p>inside needle</p><input id=di value="x"></dialog>
<script>document.getElementById('d').showModal();</script></body>`;

test('works while the page has a modal <dialog> open (typing, buttons, highlights)', async ({ rx, serve }) => {
  await serve({ 'a.test/dialog': PAGE });
  const { page } = rx;
  await page.goto('https://a.test/dialog');
  await rx.open();
  await rx.type('needle');
  const s = await rx.settle();
  expect(s.query.pattern).toBe('needle');
  expect(s.total).toBe(2);
  const box = await page.evaluate(() => { const r = document.querySelector('rx-find-bar')!.getBoundingClientRect(); return { x: r.right, y: r.top }; });
  const before = (await rx.state()).current;
  await page.mouse.click(box.x - 82, box.y + 23); // the ↓ button
  await expect.poll(async () => (await rx.state()).current).not.toBe(before);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('rx-find-bar'))).toBe(false);
  expect(await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).open)).toBe(true);
});
