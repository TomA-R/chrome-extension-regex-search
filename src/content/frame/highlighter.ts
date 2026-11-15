import { flatParent, type DomModel } from './dom-source';

// Only matches near the viewport are registered: repaint cost scales with registered ranges.
const BIG_CONTAINER = 200;
const MAX_OBSERVED = 8000;

export class Highlighter {
  private readonly all = new Highlight();
  private readonly cur = new Highlight();
  private readonly sheet = new CSSStyleSheet();
  private io: IntersectionObserver | null = null;
  private ioMargin = 0;
  private model: DomModel | null = null;
  private ranges: number[] = [];
  private byCont = new Map<Element, number[]>();
  private prevCont = new Map<Element, Element>();
  private live = new Set<Element>();
  private registered = new Map<number, Range>();
  private cache = new Map<number, Range>();
  private reusable = new Map<Node, Range[]>();
  private current = -1;
  private pending = false;
  private laidOut: Promise<void> = Promise.resolve();
  private resolveLaidOut: () => void = () => {};
  // Pages may clear CSS.highlights or replace adoptedStyleSheets at any time.
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly names: { all: string; cur: string }, colors: { match: string; current: string }) {
    this.cur.priority = 1;
    this.setColors(colors);
  }

  private listening = false;
  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      addEventListener('scroll', this.schedule, { capture: true, passive: true });
      addEventListener('resize', this.onResize, { passive: true });
    } else {
      removeEventListener('scroll', this.schedule, true);
      removeEventListener('resize', this.onResize);
    }
  }

  private get margin(): number { return Math.max(400, innerHeight); }

  setColors(c: { match: string; current: string }): void {
    this.sheet.replaceSync(
      `::highlight(${this.names.all}){background-color:${c.match};color:#000}` +
      `::highlight(${this.names.cur}){background-color:${c.current};color:#000}`,
    );
  }

  // Resolves after layout; geometry reads before that force a synchronous layout.
  whenLaidOut(): Promise<void> { return this.laidOut; }

  setMatches(model: DomModel, ranges: number[]): void {
    this.resolveLaidOut(); // never leave a waiter hanging on a superseded match set
    this.model = model;
    this.ranges = ranges;
    // Keep `all` as is: ranges that still match identically are reused, so unchanged highlights don't repaint.
    this.reusable.clear();
    for (const r of this.registered.values()) {
      const list = this.reusable.get(r.startContainer);
      if (list) list.push(r); else this.reusable.set(r.startContainer, [r]);
    }
    this.cache.clear();
    this.registered.clear();
    this.current = -1;

    const byCont = new Map<Element, number[]>();
    const segs = model.segs;
    let k = 0;
    for (let i = 0; i < ranges.length / 2; i++) {
      const start = ranges[2 * i]!;
      while (k < segs.length && segs[k]!.start + segs[k]!.length <= start) k++;
      const seg = segs[k];
      if (!seg || seg.kind !== 'text') continue;
      const list = byCont.get(seg.block);
      if (list) list.push(i); else byCont.set(seg.block, [i]);
    }
    this.byCont = byCont.size > MAX_OBSERVED ? coarsen(byCont) : byCont;
    this.prevCont.clear();
    let prev: Element | null = null;
    for (const c of this.byCont.keys()) { if (prev) this.prevCont.set(c, prev); prev = c; }

    // Diff the observed set: unchanged containers keep their intersection state.
    if (!this.io || this.ioMargin !== this.margin) this.resetObserver();
    const io = this.io!;
    let added = 0;
    for (const c of [...this.live]) if (!this.byCont.has(c)) this.live.delete(c);
    for (const c of this.observedSet) if (!this.byCont.has(c)) { io.unobserve(c); this.observedSet.delete(c); }
    for (const c of this.byCont.keys()) if (!this.observedSet.has(c)) { io.observe(c); this.observedSet.add(c); added++; }

    let resolve!: () => void;
    this.laidOut = new Promise<void>((r) => { resolve = r; });
    this.resolveLaidOut = resolve;
    if (!added) requestAnimationFrame(() => setTimeout(resolve, 0)); // after the next layout
    this.watchdog ??= setInterval(() => this.ensureRegistered(), 1000);
    this.listen(true);
    this.sync();
  }

  private observedSet = new Set<Element>();

  private resetObserver(): void {
    this.io?.disconnect();
    this.observedSet.clear();
    this.live.clear();
    this.ioMargin = this.margin;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) this.live.add(e.target);
        else this.live.delete(e.target);
      }
      this.sync();
      this.resolveLaidOut();
    }, { rootMargin: `${this.ioMargin}px 0px`, scrollMargin: `${this.ioMargin}px 0px` } as IntersectionObserverInit);
  }

  private onResize = (): void => {
    if (this.model && this.ioMargin !== this.margin) {
      this.resetObserver();
      for (const c of this.byCont.keys()) { this.io!.observe(c); this.observedSet.add(c); }
    }
    this.schedule();
  };

  rangeOf(i: number): Range | null {
    const hit = this.cache.get(i);
    if (hit) return hit;
    const m = this.model;
    if (!m || i < 0 || 2 * i >= this.ranges.length) return null;
    const loc = m.locate(this.ranges[2 * i]!, this.ranges[2 * i + 1]!);
    if (!loc || loc.kind !== 'text') return null;
    const old = this.reusable.get(loc.startNode)?.find((r) => r.startOffset === loc.startOffset && r.endContainer === loc.endNode && r.endOffset === loc.endOffset);
    if (old) { this.cache.set(i, old); return old; }
    try {
      const r = new Range();
      r.setStart(loc.startNode, Math.min(loc.startOffset, loc.startNode.length));
      r.setEnd(loc.endNode, Math.min(loc.endOffset, loc.endNode.length));
      this.cache.set(i, r);
      return r;
    } catch {
      return null; // node detached since indexing
    }
  }

  // Call after layout.
  markerFractions(samplesPerContainer = 200): number[] {
    const height = document.documentElement.scrollHeight;
    if (!this.model || height <= innerHeight * 1.2) return [];
    const out: number[] = [];
    const push = (r: DOMRect) => { if (r.width || r.height) out.push((r.top + scrollY) / height); };
    for (const [c, list] of this.byCont) {
      if (list.length <= BIG_CONTAINER) { push(c.getBoundingClientRect()); continue; }
      const step = Math.max(1, Math.floor(list.length / samplesPerContainer));
      for (let k = 0; k < list.length; k += step) { const r = this.rangeOf(list[k]!); if (r) push(r.getBoundingClientRect()); }
    }
    return out.sort((a, b) => a - b);
  }

  setCurrent(i: number): void {
    this.current = i;
    const r = i >= 0 ? this.rangeOf(i) : null;
    // Unchanged after a background refresh: touching the highlight would repaint for nothing.
    if (!(r && this.cur.size === 1 && this.cur.has(r))) {
      this.cur.clear();
      if (r) this.cur.add(r);
    }
    this.ensureRegistered();
  }

  private schedule = (): void => {
    if (this.pending || !this.model) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.sync(); });
  };

  sync(): void {
    if (!this.model) return;
    this.ensureRegistered();
    const want = new Set<number>();
    const set = new Set(this.live);
    // IntersectionObserver only sees a box's first fragment (multi-column): include predecessors.
    for (const c of this.live) { const p = this.prevCont.get(c); if (p) set.add(p); }
    const margin = this.margin;
    for (const c of set) {
      const list = this.byCont.get(c);
      if (!list) continue;
      if (list.length <= BIG_CONTAINER) { for (const i of list) want.add(i); continue; }
      // Within one container, document order == visual order: binary-search the visible slice.
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = this.rangeOf(list[mid]!);
        if (r && r.getBoundingClientRect().bottom < -margin) lo = mid + 1; else hi = mid;
      }
      for (let k = lo; k < list.length; k++) {
        const r = this.rangeOf(list[k]!);
        if (r && r.getBoundingClientRect().top > innerHeight + margin) break;
        want.add(list[k]!);
      }
    }
    for (const [i, r] of this.registered) if (!want.has(i)) { this.all.delete(r); this.registered.delete(i); }
    for (const i of want) {
      if (this.registered.has(i)) continue;
      const r = this.rangeOf(i);
      if (!r) continue;
      if (!this.all.has(r)) this.all.add(r);
      this.registered.set(i, r);
    }
    if (this.reusable.size) {
      // Ranges from the previous match set that didn't carry over.
      const keep = new Set(this.registered.values());
      for (const r of this.all) if (!keep.has(r as Range)) this.all.delete(r);
      this.reusable.clear();
    }
    // Drop out-of-window live ranges so the DOM stops updating thousands of them.
    if (this.cache.size > want.size * 2 + 512) for (const k of this.cache.keys()) if (!want.has(k) && k !== this.current) this.cache.delete(k);
  }

  private ensureRegistered(): void {
    if (CSS.highlights.get(this.names.all) !== this.all) CSS.highlights.set(this.names.all, this.all);
    if (CSS.highlights.get(this.names.cur) !== this.cur) CSS.highlights.set(this.names.cur, this.cur);
    if (!document.adoptedStyleSheets.includes(this.sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
  }

  clear(): void {
    this.resolveLaidOut();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.listen(false);
    this.io?.disconnect();
    this.io = null;
    this.observedSet.clear();
    this.byCont.clear();
    this.prevCont.clear();
    this.live.clear();
    this.cache.clear();
    this.reusable.clear();
    this.registered.clear();
    this.all.clear();
    this.cur.clear();
    this.current = -1;
    this.model = null;
    this.ranges = [];
    CSS.highlights.delete(this.names.all);
    CSS.highlights.delete(this.names.cur);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== this.sheet);
  }

  destroy(): void {
    this.clear();
  }
}

// Merged containers are big, so sync() narrows them by binary search on geometry.
export function coarsen(byCont: Map<Element, number[]>, max = MAX_OBSERVED): Map<Element, number[]> {
  let cur = byCont;
  for (let round = 0; round < 32 && cur.size > max; round++) {
    const next = new Map<Element, number[]>();
    for (const [c, list] of cur) {
      const p = flatParent(c) ?? c;
      const into = next.get(p);
      if (into) into.push(...list); else next.set(p, [...list]);
    }
    if (next.size === cur.size) break;
    cur = next;
  }
  for (const list of cur.values()) list.sort((a, b) => a - b);
  return new Map([...cur].sort((a, b) => a[1][0]! - b[1][0]!));
}
