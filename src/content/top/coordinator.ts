import { compileQuery, sameQuery, type Query } from '../../core/query';
import type { AgentApi, AgentRequest, AgentUpdate, CoordState, Method, ReplaceResult, Request, Result, SearchSpec, Snippet } from '../../shared/messages';
import type { Settings } from '../../shared/settings';

export interface AgentBus {
  request<K extends Method<AgentApi>>(frameId: number, req: Request<AgentApi, K>): Promise<Result<AgentApi, K> | null>;
  broadcast(req: AgentRequest): void;
}

export interface CoordinatorDeps {
  bus: AgentBus;
  settings: () => Settings;
  // At most once per query, when the user actually used its results.
  recordHistory: (q: Query) => void;
}

interface FrameInfo {
  count: number;
  total: number;
  status: AgentUpdate['status'];
  truncated: boolean;
  error?: string;
  firstVisible: number;
  embeds: [string, number][];
}

interface Run { frameId: number; from: number; to: number }

type Listener = (s: CoordState) => void;

// Orders matches across frames: an iframe's matches appear at the iframe's position in its parent.
export class Coordinator {
  private session = 0;
  private frames = new Map<number, FrameInfo>();
  private runCache: Run[] | null = null;
  private tokens = new Map<string, number>();
  private current: { frameId: number; index: number } | null = null;
  private currentEditable = false;
  private wantInitial = false;
  // Takes precedence over aggregated frame status.
  private pending = false;
  private queryError: string | undefined;
  private recorded = false;
  private gotoSeq = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private emitPending = false;
  private s: CoordState;

  constructor(private d: CoordinatorDeps) {
    this.s = { open: false, query: { pattern: '', ...d.settings().defaults }, status: 'idle', total: 0, matched: 0, current: -1, truncated: false, currentEditable: false, frames: 0 };
  }

  get state(): CoordState { return this.s; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.s);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.emitPending) return;
    this.emitPending = true;
    queueMicrotask(() => {
      this.emitPending = false;
      for (const fn of this.listeners) fn(this.s);
    });
  }

  private patch(p: Partial<CoordState>): void {
    this.s = { ...this.s, ...p };
    this.emit();
  }


  open(q?: Query): void {
    if (this.s.open) { if (q) this.setQuery(q, true); return; }
    if (q) this.s = { ...this.s, query: q };
    this.setOpen(true);
  }

  setOpen(open: boolean): void {
    if (open === this.s.open) return;
    this.patch({ open });
    if (!open) this.stop();
    else if (this.s.query.pattern) this.run(this.s.query);
  }

  stop(): void {
    this.maybeRecord();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.session++;
    this.pending = false;
    this.queryError = undefined;
    this.current = null;
    this.frames.clear();
    void this.d.bus.request(0, { t: 'agent.stop' });
    this.d.bus.broadcast({ t: 'agent.stop' });
    this.patch({ status: 'idle', total: 0, matched: 0, current: -1, truncated: false, currentEditable: false, error: undefined, frames: 0 });
  }

  private maybeRecord(): void {
    if (!this.recorded && this.s.query.pattern && this.s.total > 0) {
      this.recorded = true;
      this.d.recordHistory(this.s.query);
    }
  }


  setQuery(q: Query, immediate = false): void {
    const changed = !sameQuery(q, this.s.query);
    if (!changed && this.s.status !== 'idle') return;
    // Pending right away so no surface shows the previous query's status as final.
    this.pending = !!q.pattern;
    this.patch({ query: q, status: q.pattern ? 'searching' : 'idle' });
    if (this.debounce) clearTimeout(this.debounce);
    if (immediate) this.run(q);
    else this.debounce = setTimeout(() => this.run(q), this.d.settings().debounceMs);
  }

  private run(q: Query): void {
    this.debounce = null;
    this.pending = false;
    const c = compileQuery(q);
    this.queryError = c.kind === 'error' ? c.message : undefined;
    if (c.kind === 'empty') { this.stop(); return; }
    // While the pattern is invalid (often mid-typing), keep the previous highlights and show the error.
    if (c.kind === 'error') { this.patch({ status: 'error', error: c.message }); return; }
    const settings = this.d.settings();
    const spec: SearchSpec = { session: ++this.session, source: c.source, flags: c.flags, max: settings.maxMatches, timeoutMs: settings.timeoutMs, searchFields: settings.searchFields };
    this.frames.clear();
    this.current = null;
    this.wantInitial = true;
    this.recorded = false;
    this.runCache = null;
    this.patch({ status: 'searching', error: undefined, current: -1, currentEditable: false });
    void this.d.bus.request(0, { t: 'agent.search', spec });
    this.d.bus.broadcast({ t: 'agent.search', spec });
  }


  onEmbedded(token: string, frameId: number): void {
    if (this.tokens.get(token) === frameId) return;
    this.tokens.set(token, frameId);
    this.runCache = null;
    if (this.frames.size) this.recompute();
  }

  onUpdate(u: AgentUpdate, frameId: number): void {
    if (u.session !== this.session) return;
    this.frames.set(frameId, { count: u.count, total: u.total, status: u.status, truncated: u.truncated, error: u.error, firstVisible: u.firstVisible, embeds: u.embeds });
    this.runCache = null;
    if (this.current?.frameId === frameId) {
      if (u.current !== undefined && u.current >= 0) this.current.index = u.current;
      if (this.current.index >= u.count) this.current = null;
    }
    if (this.wantInitial && !this.current) this.pickInitial();
    this.recompute();
  }

  private pickInitial(): void {
    const top = this.frames.get(0);
    if (top && top.count > 0) {
      this.wantInitial = false;
      void this.goto(0, Math.max(0, top.firstVisible));
      return;
    }
    if (!top || top.status === 'indexing') return; // wait: top-frame matches take precedence
    const first = this.runs()[0];
    if (first) { this.wantInitial = false; void this.goto(first.frameId, first.from); }
  }

  // Each iframe's matches are spliced in at the iframe's position in its parent.
  runs(): Run[] {
    if (this.runCache) return this.runCache;
    const out: Run[] = [];
    const seen = new Set<number>();
    const visit = (f: number) => {
      if (seen.has(f)) return;
      seen.add(f);
      const info = this.frames.get(f);
      const count = info?.count ?? 0;
      let pos = 0;
      for (const [token, before] of [...(info?.embeds ?? [])].sort((a, b) => a[1] - b[1])) {
        const child = this.tokens.get(token);
        if (child === undefined) continue; // not announced yet: placed last for now
        const b = Math.min(before, count);
        if (b > pos) { out.push({ frameId: f, from: pos, to: b }); pos = b; }
        visit(child);
      }
      if (count > pos) out.push({ frameId: f, from: pos, to: count });
    };
    visit(0);
    for (const f of [...this.frames.keys()].sort((a, b) => a - b)) visit(f);
    this.runCache = out;
    return out;
  }

  order(): number[] {
    return [...new Set(this.runs().map((r) => r.frameId))];
  }

  private globalOf(frameId: number, index: number): number {
    let acc = 0;
    for (const r of this.runs()) {
      if (r.frameId === frameId && index >= r.from && index < r.to) return acc + index - r.from;
      acc += r.to - r.from;
    }
    return -1;
  }

  private atGlobal(n: number): { frameId: number; index: number } | null {
    for (const r of this.runs()) {
      const len = r.to - r.from;
      if (n < len) return { frameId: r.frameId, index: r.from + n };
      n -= len;
    }
    return null;
  }

  private parentOf(frameId: number): { parent: number; token: string } | null {
    for (const [p, info] of this.frames) for (const [token] of info.embeds) if (this.tokens.get(token) === frameId) return { parent: p, token };
    return null;
  }

  private recompute(): void {
    let total = 0, matched = 0, truncated = false, indexing = false;
    let error: string | undefined;
    let status: CoordState['status'] = 'done';
    const current = this.current ? this.globalOf(this.current.frameId, this.current.index) : -1;
    for (const info of this.frames.values()) {
      total += info.count;
      matched += info.total;
      truncated ||= info.truncated;
      if (info.status === 'indexing') indexing = true;
      if (info.status === 'timeout' || info.status === 'error') { status = info.status; error = info.error; }
    }
    if (indexing && status === 'done') status = 'indexing';
    if (this.pending) { status = 'searching'; error = undefined; }
    else if (this.queryError) { status = 'error'; error = this.queryError; }
    this.patch({ total, matched, truncated, current, status, error, frames: this.frames.size, currentEditable: this.current ? this.currentEditable : false });
  }


  async goto(frameId: number, index: number): Promise<void> {
    const seq = ++this.gotoSeq;
    const session = this.session;
    const stale = () => seq !== this.gotoSeq || session !== this.session;
    const prev = this.current;
    this.current = { frameId, index };
    this.recompute();
    if (prev && prev.frameId !== frameId) void this.d.bus.request(prev.frameId, { t: 'agent.clearCurrent' });
    // Bring the iframe chain into view outermost first, then let the frame scroll itself.
    const chain: { parent: number; token: string }[] = [];
    for (let f = frameId, p = this.parentOf(f); f !== 0 && p; f = p.parent, p = this.parentOf(f)) chain.unshift(p);
    for (const { parent, token } of chain) {
      await this.d.bus.request(parent, { t: 'agent.scrollChildIntoView', token });
      if (stale()) return;
    }
    const r = await this.d.bus.request(frameId, { t: 'agent.goto', session, index });
    if (stale()) return;
    this.currentEditable = !!r?.editable;
    this.recompute();
  }

  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  private step(dir: 1 | -1): void {
    const total = this.s.total;
    if (!total) return;
    this.maybeRecord();
    const cur = this.current;
    const g = cur ? this.globalOf(cur.frameId, cur.index) : -1;
    let target: number;
    if (g < 0) {
      const top = this.frames.get(0);
      // Like native find: start from the first match in view (top frame), else the ends.
      target = dir === 1 && top?.count ? this.globalOf(0, Math.max(0, top.firstVisible)) : dir === 1 ? 0 : total - 1;
    } else {
      target = (g + dir + total) % total;
    }
    const t = this.atGlobal(target);
    if (t) void this.goto(t.frameId, t.index);
  }



  async snippets(offset: number, limit: number): Promise<{ items: Snippet[]; total: number }> {
    const items: Snippet[] = [];
    let acc = 0;
    for (const r of this.runs()) {
      const len = r.to - r.from;
      if (items.length >= limit) break;
      if (acc + len <= offset) { acc += len; continue; }
      const start = r.from + Math.max(0, offset - acc);
      const n = Math.min(r.to - start, limit - items.length);
      const got = (await this.d.bus.request(r.frameId, { t: 'agent.snippets', start, limit: n })) ?? [];
      for (const s of got) items.push({ ...s, frameId: r.frameId });
      acc += len;
    }
    return { items, total: this.s.total };
  }

  async allTexts(): Promise<string[]> {
    const per = new Map<number, string[]>();
    for (const f of this.order()) per.set(f, (await this.d.bus.request(f, { t: 'agent.texts' })) ?? []);
    return this.runs().flatMap((r) => (per.get(r.frameId) ?? []).slice(r.from, r.to));
  }

  async replace(template: string, all: boolean): Promise<ReplaceResult> {
    const sum: ReplaceResult = { replaced: 0, skipped: 0 };
    if (all) {
      for (const f of this.order()) {
        const r = await this.d.bus.request(f, { t: 'agent.replace', index: 'all', template });
        if (r) { sum.replaced += r.replaced; sum.skipped += r.skipped; }
      }
      return sum;
    }
    const cur = this.current;
    if (!cur) return sum;
    const r = await this.d.bus.request(cur.frameId, { t: 'agent.replace', index: cur.index, template });
    if (r?.current !== undefined && r.current >= 0) await this.goto(cur.frameId, r.current);
    return r ?? sum;
  }
}
