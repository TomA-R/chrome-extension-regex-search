import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import type { CoordApi, CoordState, Method, Request, Result } from '../../src/shared/messages';
import { trackContext } from '../coverage';

const EXT = path.resolve('dist/chrome-mv3');

export interface Served { body: string; headers?: Record<string, string> }
export type Site = Record<string, Served | string>;

type Fixtures = {
  context: BrowserContext;
  sw: Worker;
  serve: (site: Site) => Promise<void>;
  rx: RxDriver;
};

export class RxDriver {
  constructor(private sw: Worker, readonly page: Page) {}

  private tab: { url: string; id: number } | null = null;

  private async tabId(): Promise<number> {
    const url = this.page.url();
    if (this.tab?.url === url) return this.tab.id;
    const id = await this.sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
    this.tab = { url, id };
    return id;
  }

  async coord<K extends Method<CoordApi>>(msg: Request<CoordApi, K>): Promise<Result<CoordApi, K>> {
    const tabId = await this.tabId();
    const r: unknown = await this.sw.evaluate(([id, m]) => chrome.tabs.sendMessage(id, m, { frameId: 0 }), [tabId, msg] as const);
    return r as Result<CoordApi, K>;
  }

  state(): Promise<CoordState> { return this.coord({ t: 'coord.getState' }); }

  async open(): Promise<void> {
    await this.coord({ t: 'coord.show' });
    await expect.poll(() => this.page.evaluate(() => document.activeElement?.localName)).toBe('rx-find-bar');
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.type(text);
  }

  async settle(): Promise<CoordState> {
    await expect.poll(async () => (await this.state()).status, { timeout: 15_000 }).toMatch(/done|error|timeout/);
    return this.state();
  }

  /** Total ranges registered in our highlights (from the main world: CSS.highlights is per document). */
  highlightSizes(page: Page = this.page): Promise<{ all: number; cur: number }> {
    return page.evaluate(() => {
      let all = 0, cur = 0;
      for (const [k, h] of CSS.highlights) { if (/^rx-.*-all$/.test(k)) all += h.size; if (/^rx-.*-cur$/.test(k)) cur += h.size; }
      return { all, cur };
    });
  }

  currentText(page: Page = this.page): Promise<string> {
    return page.evaluate(() => {
      for (const [k, h] of CSS.highlights) if (/^rx-.*-cur$/.test(k)) for (const r of h) { const x = new Range(); x.setStart(r.startContainer, r.startOffset); x.setEnd(r.endContainer, r.endOffset); return x.toString(); }
      return '';
    });
  }
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1200, height: 800 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...(process.env.CHROMIUM_ARGS?.split(" ").filter(Boolean) ?? [])],
    });
    const save = trackContext(ctx);
    await use(ctx);
    await save();
    await ctx.close();
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  serve: async ({ context }, use) => {
    await use(async (site) => {
      await context.route(/^https:\/\/[a-z]+\.test\//, (route) => {
        const u = new URL(route.request().url());
        const key = u.host + u.pathname;
        const s = site[key];
        if (s === undefined) return route.fulfill({ status: 404, body: 'nope' });
        const served = typeof s === 'string' ? { body: s } : s;
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: served.headers, body: served.body });
      });
    });
  },
  rx: async ({ context, sw }, use) => {
    const page = await context.newPage();
    await use(new RxDriver(sw, page));
  },
});

export { expect };
