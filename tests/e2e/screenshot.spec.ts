import { test } from './harness';

// Store screenshots: SHOTS=1 npx playwright test screenshot
const DOC = `<!doctype html><html><head><style>
  body{font:17px/1.6 Georgia,serif;max-width:760px;margin:56px auto;padding:0 20px;color:#1f2328}
  h1{font:700 34px/1.2 system-ui,sans-serif;margin-bottom:6px} .meta{color:#666;font:14px system-ui,sans-serif}
  code{font:14px ui-monospace,Menlo,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px}
  textarea{width:100%;font:14px ui-monospace,Menlo,monospace;border:1px solid #ccc;border-radius:6px;padding:8px}
  table{border-collapse:collapse;font:14px system-ui,sans-serif}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}
</style></head><body>
<h1>Incident report: checkout latency</h1>
<div class=meta>Filed by the on-call team · 2026-11-14 · contact <a href="#">oncall@example.com</a></div>
<p>Between 09:12 and 09:47 UTC, requests to <code>/api/checkout</code> returned <b>ERROR-4211</b> and ERROR-4307.
Customers reported timeouts; escalations went to <a href="#">support@example.com</a> and <b>payments-lead@example.org</b>.</p>
<table><tr><th>Service</th><th>Error</th><th>Owner</th></tr>
<tr><td>checkout</td><td>ERROR-4211</td><td>pay-team@example.com</td></tr>
<tr><td>inventory</td><td>ERROR-5120</td><td>stock@example.net</td></tr></table>
<p>Follow-ups are tracked in TICKET-882 and TICKET-901. Notes for the post-mortem:</p>
<textarea rows=4>- page ops@example.net when ERROR-4211 rate > 1%
- retry budget for ERROR-4307 lowered to 2</textarea>
<p>Root cause: a connection pool limit. The fix shipped in release 2.4.1 and was verified by qa@example.com.</p>
</body></html>`;

test('screenshots', async ({ rx, serve, context }) => {
  test.skip(!process.env.SHOTS, 'set SHOTS=1');
  await serve({ 'a.test/s': DOC });
  for (const scheme of ['light', 'dark'] as const) {
    const page = rx.page;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('https://a.test/s');
    await rx.open();
    await rx.type('[\\w.-]+@\\w+\\.(com|org|net)');
    await rx.settle();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/shots/store-emails-${scheme}.png` });
    await rx.type('ERROR-\\d+');
    await rx.settle();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/shots/store-errors-${scheme}.png` });
    await rx.type('(foo');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/shots/error-${scheme}.png`, clip: { x: 680, y: 0, width: 600, height: 160 } });
    await page.keyboard.press('Escape');
  }
  void context;
});
