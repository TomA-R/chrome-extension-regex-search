// transform/opacity only: compositor animations, no repaint per frame.
const CSS_TEXT = `
div {
  position: fixed; border-radius: 5px; pointer-events: none; will-change: transform, opacity;
  border: 2px solid var(--c); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 35%, transparent);
  animation: pulse .6s ease-out forwards;
}
@keyframes pulse {
  from { transform: scale(1.4); opacity: .95; }
  to { transform: scale(1); opacity: 0; }
}`;

let sheet: CSSStyleSheet | null = null;
let active: (() => void) | null = null;

export function cancelPulse(): void { active?.(); }

export function pulse(rect: DOMRect, color: string, exclude: Set<Element>): void {
  cancelPulse();
  if (!rect.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = document.createElement('rx-find-pulse');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;will-change:transform;contain:strict';
  const root = host.attachShadow({ mode: 'closed' });
  sheet ??= new CSSStyleSheet();
  sheet.replaceSync(CSS_TEXT);
  root.adoptedStyleSheets = [sheet];
  const ring = document.createElement('div');
  Object.assign(ring.style, { left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
  ring.style.setProperty('--c', color);
  root.append(ring);
  exclude.add(host);
  document.documentElement.append(host);
  // The ring is viewport-fixed: once the page scrolls it no longer marks the match.
  const done = () => {
    host.remove();
    exclude.delete(host);
    removeEventListener('scroll', done, true);
    if (active === done) active = null;
  };
  active = done;
  addEventListener('scroll', done, { capture: true, passive: true });
  ring.addEventListener('animationend', done);
  setTimeout(done, 1000);
}
