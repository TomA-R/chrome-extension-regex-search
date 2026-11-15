import { expect, test } from './harness';

// Diagnostic against live websites (needs network): REAL=1 npx playwright test real
const SITES: [string, string, string][] = [
  ['https://en.wikipedia.org/wiki/Regular_expression', 'regular expressions?', 'regular expression'],
  ['https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp', 'RegExp', 'RegExp'],
  ['https://html.spec.whatwg.org/multipage/parsing.html', 'tokeni[sz]er', 'tokenizer'],
  ['https://github.com/microsoft/TypeScript', 'TypeScript', 'TypeScript'],
  ['https://news.ycombinator.com/', '\\d+ points', 'points'],
  ['https://www.bbc.com/news', 'the', 'the'],
];

for (const [url, pattern, word] of SITES) {
  test(`real site: ${new URL(url).host}${new URL(url).pathname.slice(0, 30)}`, async ({ rx }) => {
    test.skip(!process.env.REAL, 'set REAL=1');
    test.setTimeout(90_000);
    const errors: string[] = [];
    rx.page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('regex-find')) errors.push(m.text()); });
    await rx.page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    await rx.page.waitForTimeout(1000);
    await rx.open();
    const t0 = Date.now();
    await rx.type(pattern);
    const s = await rx.settle();
    const ms = Date.now() - t0;
    // Rough oracle: ours also sees shadow DOM and form fields.
    const oracle = await rx.page.evaluate((w) => (document.body.innerText.match(new RegExp(w, 'gi')) ?? []).length, word);
    for (let i = 0; i < 5; i++) await rx.page.keyboard.press('Enter');
    await expect.poll(async () => (await rx.state()).current).toBe(Math.min(5, s.total - 1) >= 0 ? (s.current + 5) % Math.max(1, s.total) : -1);
    const cur = await rx.currentText();
    const visible = await rx.page.evaluate(() => {
      for (const [k, h] of CSS.highlights) if (/-cur$/.test(k)) for (const r of h) { const x = new Range(); x.setStart(r.startContainer, r.startOffset); x.setEnd(r.endContainer, r.endOffset); const b = x.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.width > 0; }
      return false;
    });
    await rx.page.screenshot({ path: `test-results/real/${new URL(url).host}.png` });
    console.log(JSON.stringify({ url, total: s.total, oracle, ms, status: s.status, current: cur, visible, frames: s.frames, errors }));
    expect(s.status).toBe('done');
    expect(errors).toEqual([]);
  });
}
