import { expect, test } from './harness';

const SHADOW = `<!doctype html><body>
<p>light needle</p>
<open-el></open-el><closed-el></closed-el>
<slot-host><span>slotted needle</span></slot-host>
<script>
  customElements.define('open-el', class extends HTMLElement { constructor() { super(); this.attachShadow({mode:'open'}).innerHTML = '<p>open <b>needle</b></p>'; } });
  customElements.define('closed-el', class extends HTMLElement { constructor() { super(); this.attachShadow({mode:'closed'}).innerHTML = '<p>closed needle</p>'; } });
  customElements.define('slot-host', class extends HTMLElement { constructor() { super(); this.attachShadow({mode:'open'}).innerHTML = '<div>before <slot></slot> after</div><p>unslotted</p>'; } });
</script></body>`;

const TOP = `<!doctype html><body><p>top needle one</p>
<iframe src="https://a.test/same" style="width:600px;height:200px"></iframe>
<div style="height:1500px"></div>
<iframe src="https://b.test/cross" style="width:600px;height:200px"></iframe>
<p>top needle two</p></body>`;

const FIELDS = `<!doctype html><body>
<p>text needle</p>
<input id=i value="input needle here">
<textarea id=t rows=3>line one
needle in textarea
needle again</textarea>
<input type=password value="needle secret">
<div contenteditable id=ce>editable needle text</div>
<p>static needle</p>
<script>
  // React-like controlled input: tracks value through input events
  window.events = 0; document.getElementById('i').addEventListener('input', () => window.events++);
</script></body>`;

test.beforeEach(async ({ serve }) => serve({
  'a.test/shadow': SHADOW,
  'a.test/top': TOP,
  'a.test/same': '<!doctype html><body><p>same-origin needle</p><p>needle 2</p></body>',
  'b.test/cross': '<!doctype html><body><p>cross-origin needle</p></body>',
  'a.test/fields': FIELDS,
  'a.test/dynamic': '<!doctype html><body><div id=feed><p>needle 0</p></div></body>',
}));

test('shadow DOM: open, closed and slotted content in rendered order', async ({ rx }) => {
  await rx.page.goto('https://a.test/shadow');
  await rx.open();
  await rx.type('needle');
  expect((await rx.settle()).total).toBe(4);
  await rx.type('before slotted needle after');
  expect((await rx.settle()).total).toBe(1);
  await rx.type('unslotted');
  expect((await rx.settle()).total).toBe(1);
});

test('iframes: same- and cross-origin frames are searched and navigated in document order', async ({ rx, context }) => {
  await rx.page.goto('https://a.test/top');
  await rx.page.waitForLoadState('load');
  await rx.open();
  await rx.type('needle');
  await expect.poll(async () => (await rx.state()).total).toBe(5);
  expect((await rx.state()).frames).toBe(3);
  const seq: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = await rx.state();
    const items = (await rx.coord({ t: 'coord.snippets', offset: s.current, limit: 1 })).items;
    const it = items[0]!;
    seq.push(`${it.frameId === 0 ? 'top' : 'frame'}: ${it.before}${it.match}${it.after}`.trim());
    await rx.page.keyboard.press('Enter');
    await expect.poll(async () => (await rx.state()).current).toBe((i + 1) % 5);
  }
  // The cross-origin iframe sits before "top needle two" in the parent.
  expect(seq).toEqual(['top: top needle one', 'frame: same-origin needle', 'frame: needle 2', 'frame: cross-origin needle', 'top: top needle two']);
  void context;
});

test('fields: inputs/textareas searched (never passwords), current field match navigable', async ({ rx }) => {
  await rx.page.goto('https://a.test/fields');
  await rx.open();
  await rx.type('needle');
  const s = await rx.settle();
  expect(s.total).toBe(6);
  await rx.coord({ t: 'coord.goto', frameId: 0, index: 1 });
  await expect.poll(async () => (await rx.state()).currentEditable).toBe(true);
  expect(await rx.page.evaluate(() => !!document.querySelector('rx-find-overlay'))).toBe(true);
});

test('replace: current in input (framework events fire), all in editables only', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/fields');
  await rx.open();
  await rx.type('need(le)');
  await rx.settle();
  await rx.coord({ t: 'coord.goto', frameId: 0, index: 1 });
  const r1 = await rx.coord({ t: 'coord.replace', template: 'pin$1', all: false });
  expect(r1.replaced).toBe(1);
  expect(await page.inputValue('#i')).toBe('input pinle here');
  expect(await page.evaluate(() => (window as unknown as { events: number }).events)).toBeGreaterThan(0);
  const r2 = await rx.coord({ t: 'coord.replace', template: 'X', all: true });
  expect(r2.replaced).toBe(3);
  expect(r2.skipped).toBe(2);
  expect(await page.inputValue('#t')).toBe('line one\nX in textarea\nX again');
  expect(await page.textContent('#ce')).toBe('editable X text');
  await expect.poll(async () => (await rx.state()).total).toBe(2);
});

test('dynamic content: new matches appear, the current match keeps its position', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/dynamic');
  await rx.open();
  await rx.type('needle \\d+');
  expect((await rx.settle()).total).toBe(1);
  await page.evaluate(() => { for (let i = 1; i <= 5; i++) { const p = document.createElement('p'); p.textContent = `needle ${i}`; document.getElementById('feed')!.append(p); } });
  await expect.poll(async () => (await rx.state()).total, { timeout: 5000 }).toBe(6);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => rx.currentText()).toBe('needle 2');
  expect((await rx.state()).current).toBe(2);
  // A match inserted before the current one shifts its index but not its identity.
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'needle 99'; document.getElementById('feed')!.prepend(p); });
  await expect.poll(async () => (await rx.state()).total, { timeout: 5000 }).toBe(7);
  await expect.poll(async () => (await rx.state()).current).toBe(3);
  expect(await rx.currentText()).toBe('needle 2');
});

test('SPA route change: content swapped via history.pushState is re-searched', async ({ rx }) => {
  const { page } = rx;
  await page.goto('https://a.test/dynamic');
  await rx.open();
  await rx.type('route');
  expect((await rx.settle()).total).toBe(0);
  await page.evaluate(() => { history.pushState({}, '', '/dynamic/next'); document.getElementById('feed')!.innerHTML = '<h1>New route</h1><p>route content, route two</p>'; });
  await expect.poll(async () => (await rx.state()).total, { timeout: 5000 }).toBe(3);
});
