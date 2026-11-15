import { flatParent } from './dom-source';

// Fires `beforematch` like native find so pages can sync their state.
export function reveal(node: Node): boolean {
  let changed = false;
  for (let a = flatParent(node); a; a = flatParent(a)) {
    if (a.getAttribute('hidden') === 'until-found') {
      a.dispatchEvent(new Event('beforematch', { bubbles: true }));
      a.removeAttribute('hidden');
      changed = true;
    }
    if (a instanceof HTMLDetailsElement && !a.open) {
      const summary = a.querySelector(':scope > summary');
      if (!summary || !summary.contains(node)) { a.open = true; changed = true; }
    }
  }
  return changed;
}

function isScroller(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return false;
  const s = getComputedStyle(el);
  const y = s.overflowY, x = s.overflowX;
  const sy = (y === 'auto' || y === 'scroll' || y === 'hidden') && el.scrollHeight > el.clientHeight;
  const sx = (x === 'auto' || x === 'scroll' || x === 'hidden') && el.scrollWidth > el.clientWidth;
  return sy || sx;
}

// Instant, and only when not already comfortably visible.
export function scrollToRect(from: Element, rect: () => DOMRect | null, opts: { avoidTop?: number } = {}): boolean {
  const margin = 40;
  let moved = false;
  for (let a = flatParent(from); a; a = flatParent(a)) {
    if (!isScroller(a)) continue;
    const r = rect();
    if (!r) return moved;
    const b = a.getBoundingClientRect();
    const top = b.top + a.clientTop, left = b.left + a.clientLeft;
    if (r.top < top + 4 || r.bottom > top + a.clientHeight - 4) { a.scrollTop += r.top + r.height / 2 - (top + a.clientHeight / 2); moved = true; }
    if (r.left < left || r.right > left + a.clientWidth) { a.scrollLeft += r.left + r.width / 2 - (left + a.clientWidth / 2); moved = true; }
  }
  const r = rect();
  if (!r) return moved;
  const minTop = margin + (opts.avoidTop ?? 0);
  const dy = r.top < minTop || r.bottom > innerHeight - margin ? r.top + r.height / 2 - innerHeight / 2 : 0;
  const dx = r.left < 0 || r.right > innerWidth ? r.left + r.width / 2 - innerWidth / 2 : 0;
  if (dx || dy) { window.scrollBy({ top: dy, left: dx, behavior: 'instant' }); moved = true; }
  return moved;
}
