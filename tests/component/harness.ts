import { test as base, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { saveCoverage, startCoverage } from '../coverage';

export const BUNDLE = path.resolve('dist/component/rx.js');

export async function load(page: Page, html: string): Promise<void> {
  await page.setContent(html);
  await page.addScriptTag({ path: BUNDLE });
}

export function buildModel(page: Page, opts: { searchFields?: boolean } = {}) {
  return page.evaluate(async (o) => {
    const { DomTextSource } = (window as any).__rx;
    const model = await new DomTextSource().build({ searchFields: o.searchFields ?? true, exclude: new Set(), signal: new AbortController().signal });
    return { text: model.text as string, segs: model.segs.length as number };
  }, opts);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await startCoverage(page);
    await use(page);
    await saveCoverage(page);
  },
});
export { expect };
