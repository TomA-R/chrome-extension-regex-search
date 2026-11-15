import { escapeLiteral, type Query } from '../../core/query';
import type { BackgroundRequest } from '../../shared/messages';
import { loadHistory } from '../../shared/settings';
import type { FrameRuntime } from '../frame/runtime';
import type { Coordinator } from './coordinator';
import { mountBar, type MountedBar } from './ui/mount';

export class BarController {
  private bar: MountedBar | null = null;
  private focusListeners = new Set<() => void>();

  constructor(private coord: Coordinator, private frame: FrameRuntime, private exclude: Set<Element>) {}

  owns(target: EventTarget | null): boolean { return !!this.bar && target === this.bar.host; }

  bottom(): number { return this.bar?.height() ?? 0; }

  async show(): Promise<void> {
    await this.frame.ready;
    if (!this.bar) {
      const coord = this.coord;
      this.bar = mountBar({
        subscribe: (fn) => coord.subscribe(fn),
        focusSignal: { subscribe: (fn) => { this.focusListeners.add(fn); return () => this.focusListeners.delete(fn); } },
        actions: {
          setQuery: (q, immediate) => coord.setQuery(q, immediate),
          next: () => coord.next(),
          prev: () => coord.prev(),
          close: () => this.hide(),
          copyAll: async () => { const t = await coord.allTexts(); await copyText(t.join('\n')); return t.length; },
          replace: (tpl, all) => coord.replace(tpl, all),
          // sidePanel.open needs a user gesture that may not survive the hop to the background.
          openPanel: async () => (await chrome.runtime.sendMessage({ t: 'bg.openPanel' } satisfies BackgroundRequest).catch(() => null)) === true,
          openOptions: () => void chrome.runtime.sendMessage({ t: 'bg.openOptions' } satisfies BackgroundRequest),
        },
      });
      this.exclude.add(this.bar.host);
    }
    this.coord.open(await this.prefill());
    for (const fn of this.focusListeners) fn();
  }

  hide(): void {
    this.coord.setOpen(false);
    if (this.bar) { this.exclude.delete(this.bar.host); this.bar.unmount(); }
    this.bar = null;
  }

  private async prefill(): Promise<Query | undefined> {
    const sel = getSelection()?.toString().trim() ?? '';
    const q = this.coord.state.query;
    if (sel && sel.length < 200 && !sel.includes('\n')) return { ...q, pattern: q.regex ? escapeLiteral(sel) : sel };
    if (!q.pattern && this.frame.settings().rememberLastQuery) return (await loadHistory())[0];
    return undefined;
  }
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* insecure context or no focus */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('style', 'position:fixed;top:0;left:0;opacity:0;pointer-events:none');
  document.documentElement.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
