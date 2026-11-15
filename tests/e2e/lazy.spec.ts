import type { Worker } from '@playwright/test';
import { expect, test } from './harness';

async function runtimeFrames(sw: Worker, url: string): Promise<boolean[]> {
  return sw.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ url: u });
    const res = await chrome.scripting.executeScript({
      target: { tabId: t!.id!, allFrames: true },
      func: () => { const b = (globalThis as unknown as Record<string, { runtime?: unknown } | undefined>).__rxFindBridge; return [!!b, !!b?.runtime]; },
    });
    return res.map((r) => (r.result as boolean[])[1]!);
  }, url);
}

test('only a tiny bootstrap runs until the user searches; the runtime loads into searched frames', async ({ rx, serve, sw }) => {
  await serve({
    'a.test/lazy': '<!doctype html><body><p>needle top</p><iframe src="https://b.test/child"></iframe></body>',
    'b.test/child': '<!doctype html><body><p>needle child</p></body>',
  });
  await rx.page.goto('https://a.test/lazy');
  await rx.page.waitForLoadState('load');
  expect(await runtimeFrames(sw, 'https://a.test/lazy')).toEqual([false, false]);
  await rx.open();
  await rx.type('needle');
  await expect.poll(async () => (await rx.state()).total).toBe(2);
  expect(await runtimeFrames(sw, 'https://a.test/lazy')).toEqual([true, true]);
});
