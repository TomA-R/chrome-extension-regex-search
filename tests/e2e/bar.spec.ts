import { expect, test } from './harness';

const PAGE = '<!doctype html><body><p id=sel>see foo.bar here</p><p>alpha one</p><p>alpha two</p><p>beta</p></body>';

test.beforeEach(async ({ serve }) => serve({ 'a.test/bar': PAGE }));

test('pre-fills the selection, escaped for regex mode', async ({ rx }) => {
  await rx.page.goto('https://a.test/bar');
  await rx.page.evaluate(() => {
    const t = document.getElementById('sel')!.firstChild!;
    getSelection()!.setBaseAndExtent(t, 4, t, 11); // "foo.bar"
  });
  await rx.open();
  const s = await rx.settle();
  expect(s.query.pattern).toBe('foo\\.bar');
  expect(s.total).toBe(1);
});

test('↑/↓ recall recent searches', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/bar');
  await rx.open();
  for (const p of ['alpha', 'beta']) {
    await rx.type(p);
    await rx.settle();
    await page.keyboard.press('Enter'); // using results records the query
  }
  await rx.type('zzz');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await rx.state()).query.pattern).toBe('beta');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await rx.state()).query.pattern).toBe('alpha');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await rx.state()).query.pattern).toBe('beta');
});

test('F3 / Shift+F3 navigate while focus is in the page', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/bar');
  await rx.open();
  await rx.type('alpha');
  await rx.settle();
  await page.mouse.click(10, 300); // focus the page, not the bar
  const start = (await rx.state()).current;
  await page.keyboard.press('F3');
  await expect.poll(async () => (await rx.state()).current).toBe((start + 1) % 2);
  await page.keyboard.press('Shift+F3');
  await expect.poll(async () => (await rx.state()).current).toBe(start);
});

test('the menu works from the keyboard: copy all matches, save pattern, Esc closes only the menu', async ({ rx, context, sw }) => {
  const { page } = rx;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://a.test' });
  await page.goto('https://a.test/bar');
  await rx.open();
  await rx.type('alpha \\w+');
  await rx.settle();
  const openMenu = async () => {
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab'); // 4 toggles, previous, next, more
    await page.keyboard.press('Enter');
  };

  await openMenu(); // focus lands on the first item: "Copy all matches"
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('alpha one\nalpha two');

  await openMenu();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // "Save pattern"
  await page.keyboard.press('Enter');
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.sync.get('saved')).saved as { name: string }[] | undefined)?.map((x) => x.name))).toEqual(['alpha \\w+']);

  await openMenu();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('rx-find-bar'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('rx-find-bar'))).toBe(false);
});

test('saved patterns can be renamed and deleted in settings', async ({ context, sw }) => {
  await sw.evaluate(() => chrome.storage.sync.set({ saved: [{ name: 'emails', query: { pattern: '\\w+@\\w+', regex: true, caseSensitive: false, wholeWord: false, dotAll: false } }] }));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await page.getByLabel('Name').fill('mail');
  await page.getByLabel('Name').blur();
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.sync.get('saved')).saved as { name: string }[])[0]?.name)).toBe('mail');
  await page.getByRole('button', { name: 'Delete mail' }).click();
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.sync.get('saved')).saved as unknown[]).length)).toBe(0);
});
