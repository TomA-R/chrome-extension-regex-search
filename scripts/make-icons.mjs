// Run from the repo root.
import { chromium } from '@playwright/test';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect x="4" y="4" width="120" height="120" rx="28" fill="#0969da"/>
<circle cx="54" cy="54" r="30" fill="none" stroke="#fff" stroke-width="12"/>
<path d="M76 76l28 28" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
<text x="54" y="66" font-family="Menlo,monospace" font-weight="700" font-size="30" fill="#ffe066" text-anchor="middle">.*</text></svg>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width=${s} height=${s}>`);
  await p.screenshot({ path: `public/icon/${s}.png`, omitBackground: true });
}
await b.close();
