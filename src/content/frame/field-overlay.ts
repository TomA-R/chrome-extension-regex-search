import type { FieldEl } from './dom-source';

// Ranges can't address input/textarea values, so field matches are boxes measured on a mirror element.
const MIRROR_PROPS = [
  'direction', 'boxSizing', 'width', 'height', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing',
  'wordSpacing', 'tabSize', 'wordBreak', 'overflowWrap', 'fontFeatureSettings', 'fontKerning',
] as const;
const MAX_BOXES = 500;

export interface FieldMatch { index: number; el: FieldEl; start: number; end: number }

function createLayerHost(tag: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag);
  host.setAttribute('style', 'all:initial !important;position:fixed !important;inset:0 !important;pointer-events:none !important;z-index:2147483646 !important;margin:0 !important;padding:0 !important;border:0 !important;background:transparent !important;width:auto !important;height:auto !important;overflow:visible !important;display:block !important');
  const root = host.attachShadow({ mode: 'closed' });
  return { host, root };
}

export class FieldOverlay {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private layer: HTMLDivElement | null = null;
  private byField = new Map<FieldEl, FieldMatch[]>();
  private current = -1;
  private pending = false;
  // Edited since the last set(): offsets are stale until the re-index lands.
  private stale = new Set<FieldEl>();

  constructor(private colors: { match: string; current: string }, private exclude: Set<Element>) {}

  setColors(c: { match: string; current: string }): void { this.colors = c; this.schedule(); }

  set(matches: FieldMatch[]): void {
    this.byField.clear();
    this.stale.clear();
    for (const m of matches) {
      const list = this.byField.get(m.el);
      if (list) list.push(m); else this.byField.set(m.el, [m]);
    }
    if (matches.length) { this.mount(); this.schedule(); } else this.unmount();
  }

  setCurrent(index: number): void { this.current = index; this.schedule(); }

  rectOf(m: FieldMatch): DOMRect | null {
    return this.measure(m.el, [m]).get(m.index)?.[0] ?? null;
  }

  revealInField(m: FieldMatch): void {
    const el = m.el;
    if (this.rectOf(m)) return;
    const pos = this.measure(el, [m], true).get(m.index)?.[0];
    if (!pos) return;
    const fr = el.getBoundingClientRect();
    el.scrollTop = Math.max(0, pos.top - fr.top - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, pos.left - fr.left - el.clientWidth / 2);
  }

  private mount(): void {
    if (this.host) return;
    const { host, root } = createLayerHost('rx-find-overlay');
    this.host = host;
    this.root = root;
    this.layer = document.createElement('div');
    root.append(this.layer);
    this.exclude.add(host);
    document.documentElement.append(host);
    addEventListener('scroll', this.schedule, { capture: true, passive: true });
    addEventListener('resize', this.schedule, { passive: true });
    addEventListener('input', this.onInput, { capture: true, passive: true });
  }

  private unmount(): void {
    if (!this.host) return;
    this.host.remove();
    this.exclude.delete(this.host);
    this.host = this.root = this.layer = null;
    removeEventListener('scroll', this.schedule, true);
    removeEventListener('resize', this.schedule);
    removeEventListener('input', this.onInput, true);
  }

  private onInput = (e: Event): void => {
    const t = e.target as FieldEl;
    if (this.byField.has(t)) { this.stale.add(t); this.schedule(); }
  };

  private schedule = (): void => {
    if (this.pending || !this.layer) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  };

  private draw(): void {
    const layer = this.layer;
    if (!layer) return;
    if (this.host && !this.host.isConnected) document.documentElement.append(this.host);
    const frag = document.createDocumentFragment();
    let drawn = 0;
    for (const [el, matches] of this.byField) {
      if (drawn >= MAX_BOXES) break;
      if (!el.isConnected || this.stale.has(el)) continue;
      const fr = el.getBoundingClientRect();
      if (!fr.width || fr.bottom < 0 || fr.top > innerHeight || fr.right < 0 || fr.left > innerWidth) continue;
      for (const [index, rects] of this.measure(el, matches)) {
        const isCur = index === this.current;
        for (const r of rects) {
          if (drawn++ >= MAX_BOXES) break;
          const b = document.createElement('div');
          // A tint, not a blend mode: the overlay is its own stacking context.
          const c = isCur ? this.colors.current : this.colors.match;
          b.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:color-mix(in srgb, ${c} 45%, transparent);box-shadow:inset 0 -2px ${c};border-radius:2px;outline:${isCur ? `2px solid ${c}` : 'none'}`;
          frag.append(b);
        }
      }
    }
    layer.replaceChildren(frag);
  }

  private measure(el: FieldEl, matches: FieldMatch[], unclipped = false): Map<number, DOMRect[]> {
    const out = new Map<number, DOMRect[]>();
    const cs = getComputedStyle(el);
    const fr = el.getBoundingClientRect();
    const isInput = el instanceof HTMLInputElement;
    const mirror = document.createElement('div');
    const st = mirror.style;
    for (const p of MIRROR_PROPS) st[p] = cs[p];
    Object.assign(st, { position: 'fixed', left: `${fr.left}px`, top: `${fr.top}px`, visibility: 'hidden', overflow: 'hidden', whiteSpace: isInput ? 'pre' : 'pre-wrap' });
    if (isInput) st.lineHeight = `${el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`;
    if (unclipped) { st.height = 'auto'; if (isInput) st.width = 'auto'; }
    const v = el.value;
    const sorted = [...matches].sort((a, b) => a.start - b.start);
    const spans: [number, HTMLSpanElement][] = [];
    let pos = 0;
    for (const m of sorted) {
      if (m.start < pos) continue;
      mirror.append(v.slice(pos, m.start));
      const span = document.createElement('span');
      span.textContent = v.slice(m.start, m.end) || '​';
      mirror.append(span);
      spans.push([m.index, span]);
      pos = m.end;
    }
    mirror.append(v.slice(pos) + (isInput ? '' : '\n'));
    (this.root ?? document.documentElement).append(mirror);
    if (!unclipped) { mirror.scrollTop = el.scrollTop; mirror.scrollLeft = el.scrollLeft; }
    const clipL = fr.left + el.clientLeft, clipT = fr.top + el.clientTop;
    const clipR = clipL + el.clientWidth, clipB = clipT + el.clientHeight;
    for (const [index, span] of spans) {
      const rects: DOMRect[] = [];
      for (const r of span.getClientRects()) {
        if (unclipped) { rects.push(r); continue; }
        const l = Math.max(r.left, clipL), t = Math.max(r.top, clipT), rr = Math.min(r.right, clipR), b = Math.min(r.bottom, clipB);
        if (rr > l && b > t) rects.push(new DOMRect(l, t, rr - l, b - t));
      }
      if (rects.length) out.set(index, rects);
    }
    mirror.remove();
    return out;
  }
}
