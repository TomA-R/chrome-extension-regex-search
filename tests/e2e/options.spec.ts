import { expect, test } from './harness';

test('options page renders and saves settings', async ({ context, sw }) => {
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await expect(page.getByRole('heading', { name: /Regex Find/ })).toBeVisible();
  await page.getByLabel('Match case').check();
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.sync.get('settings')).settings as { defaults?: { caseSensitive?: boolean } } | undefined)?.defaults?.caseSensitive)).toBe(true);
  expect(errors).toEqual([]);
});
