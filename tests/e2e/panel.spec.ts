import { expect, test } from './harness';

test('side panel: lists matches with context, click navigates, typing drives the page', async ({ rx, serve, context, sw }) => {
  await serve({ 'a.test/p': '<!doctype html><body><p>alpha one</p><p>beta two</p><p>alpha three</p></body>' });
  await rx.page.goto('https://a.test/p');
  await rx.page.bringToFront();
  await rx.open();
  await rx.type('alpha');
  await rx.settle();
  const extId = new URL(sw.url()).host;
  // The side panel is browser UI; load its page in a tab.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await rx.page.bringToFront();
  await panel.evaluate(() => location.reload());
  await expect(panel.locator('.item')).toHaveCount(2, { timeout: 10_000 });
  await expect(panel.locator('.item').first()).toContainText('alpha one');
  await panel.locator('.item').nth(1).click();
  await expect.poll(async () => (await rx.state()).current).toBe(1);
  await panel.locator('header input').first().fill('two|three');
  await expect.poll(async () => (await rx.state()).total).toBe(2);
});

test('side panel: replace all in editable fields, and copy results as JSON', async ({ rx, serve, context, sw }) => {
  await serve({ 'a.test/f': '<!doctype html><body><p>static needle</p><textarea id=t>needle one, needle two</textarea></body>' });
  await rx.page.goto('https://a.test/f');
  await rx.page.bringToFront();
  await rx.open();
  await rx.type('needle');
  await rx.settle();
  // Extension origins can't be granted clipboard permissions; read it back from the page.
  await context.grantPermissions(['clipboard-read'], { origin: 'https://a.test' });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${new URL(sw.url()).host}/sidepanel.html`);
  await rx.page.bringToFront();
  await panel.evaluate(() => location.reload());
  await expect(panel.locator('.item')).toHaveCount(3, { timeout: 10_000 });

  await panel.getByText('Replace & export').click();
  await panel.getByRole('button', { name: 'JSON' }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied 3 results as JSON');
  const json = JSON.parse(await rx.page.evaluate(() => navigator.clipboard.readText())) as { match: string; frameId: number }[];
  expect(json.map((x) => x.match)).toEqual(['needle', 'needle', 'needle']);

  await panel.getByLabel('Replacement').fill('pin');
  await panel.getByRole('button', { name: 'Replace all' }).click();
  await expect(panel.getByRole('status')).toHaveText('Replaced 2 · 1 not editable');
  expect(await rx.page.inputValue('#t')).toBe('pin one, pin two');
});
