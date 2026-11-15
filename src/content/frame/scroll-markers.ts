export class ScrollMarkers {
  private host: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private fractions: number[] = [];
  private current: number | null = null;
  private pending = false;

  constructor(private colors: { match: string; current: string }, private exclude: Set<Element>) {}

  setColors(c: { match: string; current: string }): void { this.colors = c; this.draw(); }

  set(fractions: number[]): void {
    this.fractions = fractions;
    if (fractions.length) this.mount(); else this.unmount();
    this.draw();
  }

  setCurrent(fraction: number | null): void { this.current = fraction; this.draw(); }

  private mount(): void {
    if (this.host) return;
    const host = document.createElement('rx-find-markers');
    // Own compositor layer: a non-composited fixed overlay makes every scroll frame repaint.
    host.style.cssText = 'all:initial;position:fixed;top:0;right:0;bottom:0;width:8px;pointer-events:none;z-index:2147483645;will-change:transform;contain:strict';
    const root = host.attachShadow({ mode: 'closed' });
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    root.append(canvas);
    this.exclude.add(host);
    document.documentElement.append(host);
    this.host = host;
    this.canvas = canvas;
    addEventListener('resize', this.schedule, { passive: true });
  }

  private unmount(): void {
    if (!this.host) return;
    this.host.remove();
    this.exclude.delete(this.host);
    this.host = this.canvas = null;
    removeEventListener('resize', this.schedule);
  }

  private schedule = (): void => {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.draw(); });
  };

  private draw(): void {
    const c = this.canvas;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const w = 8 * dpr, h = Math.max(1, innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const tick = Math.max(2, Math.round(2 * dpr));
    const y = (f: number) => Math.min(h - tick, Math.max(0, Math.round(f * h)));
    g.globalAlpha = 0.85;
    g.fillStyle = this.colors.match;
    let last = -1;
    for (const f of this.fractions) {
      const py = y(f);
      if (py === last) continue; // many matches per pixel row
      g.fillRect(2 * dpr, py, w - 2 * dpr, tick);
      last = py;
    }
    if (this.current !== null) {
      g.globalAlpha = 1;
      g.fillStyle = this.colors.current;
      g.fillRect(0, y(this.current) - dpr, w, tick + 2 * dpr);
    }
  }

  destroy(): void { this.unmount(); this.fractions = []; this.current = null; }
}
