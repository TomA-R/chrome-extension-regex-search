import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const COVERAGE = !!process.env.COVERAGE;
const RAW = path.resolve('coverage/raw');

export async function startCoverage(page: Page): Promise<void> {
  if (COVERAGE) await page.coverage.startJSCoverage({ resetOnNavigation: false });
}

export async function saveCoverage(page: Page): Promise<void> {
  if (!COVERAGE || page.isClosed()) return;
  const entries = await page.coverage.stopJSCoverage().catch(() => []);
  const ours = entries.filter((e) => e.url.startsWith('chrome-extension://') || e.url.endsWith('/rx.js'));
  if (!ours.length) return;
  mkdirSync(RAW, { recursive: true });
  writeFileSync(path.join(RAW, `${randomUUID()}.json`), JSON.stringify(ours));
}

// Coverage for every page a context opens (extension pages included).
export function trackContext(context: BrowserContext): () => Promise<void> {
  if (!COVERAGE) return async () => {};
  const pages = new Set<Page>();
  const track = (p: Page) => { pages.add(p); void startCoverage(p); };
  context.pages().forEach(track);
  context.on('page', track);
  return async () => { for (const p of pages) await saveCoverage(p); };
}
