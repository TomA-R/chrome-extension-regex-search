import type { AgentStatus, AgentUpdate, ReplaceResult, SearchSpec, Snippet } from '../../shared/messages';
import type { DomModel, TextSource } from './dom-source';
import { applyEdits, isEditableField, type Edit } from './editing';
import { FieldOverlay, type FieldMatch } from './field-overlay';
import { Highlighter } from './highlighter';
import { embedToken } from './frames';
import { Indexer } from './indexer';
import { MatcherError, type Matcher, type MatchQuery } from './matcher-client';
import { reveal, scrollToRect } from './navigate';
import { snippetAt } from '../../core/snippet';
import { cancelPulse, pulse } from './pulse';
import { ScrollMarkers } from './scroll-markers';

export interface AgentDeps {
  source: TextSource;
  matcher: Matcher;
  report: (u: AgentUpdate) => void;
  exclude: Set<Element>;
  names: { all: string; cur: string };
  colors: { match: string; current: string };
  // Viewport pixels covered by our find bar.
  avoidTop?: () => number;
}

// Swapped atomically so no field can be newer than another.
interface Snapshot {
  spec: SearchSpec;
  model: DomModel;
  ranges: number[];
  total: number;
  truncated: boolean;
  final: boolean;
  fields: ReadonlyMap<number, FieldMatch>;
}

type Anchor =
  | { kind: 'node'; node: Text; offset: number }
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement; offset: number }
  | { kind: 'offset'; offset: number };

function embedsOf(snap: { model: DomModel; ranges: number[] }): [string, number][] {
  const out: [string, number][] = [];
  const n = snap.ranges.length / 2;
  for (const e of snap.model.embeds) {
    const id = embedToken(e.el);
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (snap.ranges[2 * mid]! < e.offset) lo = mid + 1; else hi = mid; }
    out.push([id, lo]);
  }
  return out;
}

const query = (spec: SearchSpec): MatchQuery => ({ source: spec.source, flags: spec.flags, max: spec.max, timeoutMs: spec.timeoutMs });

export class Agent {
  private readonly indexer: Indexer;
  private readonly highlighter: Highlighter;
  private readonly overlay: FieldOverlay;
  private readonly markers: ScrollMarkers;
  private spec: SearchSpec | null = null;
  private snap: Snapshot | null = null;
  private current = -1;
  private seq = 0;
  private pendingAnchor: Anchor | null = null;
  private onInstalled: ((current: number) => void) | null = null;
  private sendChain: Promise<void> = Promise.resolve();
  private markedCount = -1;

  private colors: { match: string; current: string };

  constructor(private d: AgentDeps) {
    this.colors = d.colors;
    this.highlighter = new Highlighter(d.names, d.colors);
    this.overlay = new FieldOverlay(d.colors, d.exclude);
    this.markers = new ScrollMarkers(d.colors, d.exclude);
    this.indexer = new Indexer({
      source: d.source,
      exclude: d.exclude,
      onModel: (model, final, reason) => void this.match(model, final, reason === 'mutation'),
    });
  }

  get matchCount(): number { return (this.snap?.ranges.length ?? 0) / 2; }

  setColors(c: { match: string; current: string }): void {
    this.colors = c;
    this.markers.setColors(c);
    this.highlighter.setColors(c);
    this.overlay.setColors(c);
  }


  search(spec: SearchSpec): void {
    this.spec = spec;
    this.current = -1;
    this.indexer.activate(spec.searchFields);
    const fresh = this.indexer.fresh;
    if (fresh) void this.match(fresh, true, false);
    else this.indexer.rebuild('query');
  }

  stop(): void {
    this.spec = null;
    this.snap = null;
    this.current = -1;
    this.seq++;
    this.indexer.deactivate();
    this.highlighter.clear();
    this.overlay.set([]);
    this.markers.destroy();
    this.markedCount = -1;
    this.d.matcher.dispose();
  }


  private async match(model: DomModel, final: boolean, keepPosition: boolean): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const seq = ++this.seq;
    const prev = this.snap;
    const anchor = keepPosition ? (this.pendingAnchor ?? this.anchorOf(this.current)) : null;
    try {
      let res: { ranges: number[]; total: number; truncated: boolean };
      if (prev && prev.spec === spec && prev.final && prev.model.text === model.text) {
        res = prev;  // only class/style churn
      } else {
        const attempt = () => this.d.matcher.search(model.text, query(spec));
        // One retry: the offscreen document may have been restarted.
        res = await attempt().catch((e: unknown) => { if (e instanceof MatcherError && e.kind === 'disconnected') return attempt(); throw e; });
      }
      if (seq !== this.seq || spec !== this.spec) return;
      const t0 = performance.now();
      this.install({ spec, model, ranges: res.ranges, total: res.total, truncated: res.truncated, final });
      if (anchor) this.current = this.matchCount ? this.resolve(anchor) : -1;
      else if (this.current >= this.matchCount) this.current = -1;
      // setMatches() resets the current highlight.
      this.setCurrentHighlight(this.current);
      if (final && keepPosition) { this.pendingAnchor = null; this.onInstalled?.(this.current); this.onInstalled = null; }
      this.indexer.addCost(performance.now() - t0);
      this.report(spec.session, final ? 'done' : 'indexing', keepPosition ? this.current : undefined);
    } catch (e) {
      if (seq !== this.seq || spec !== this.spec) return;
      if (e instanceof MatcherError && e.kind === 'superseded') return;
      this.install({ spec, model, ranges: [], total: 0, truncated: false, final: true });
      const timeout = e instanceof MatcherError && e.kind === 'timeout';
      this.report(spec.session, timeout ? 'timeout' : 'error', undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private install(s: Omit<Snapshot, 'fields'>): void {
    const fields = new Map<number, FieldMatch>();
    if (s.model.hasFields) {
      for (let i = 0; i < s.ranges.length / 2; i++) {
        const loc = s.model.locate(s.ranges[2 * i]!, s.ranges[2 * i + 1]!);
        if (loc?.kind === 'field') fields.set(i, { index: i, el: loc.el, start: loc.start, end: loc.end });
      }
    }
    this.snap = { ...s, fields };
    this.highlighter.setMatches(s.model, s.ranges);
    this.overlay.set([...fields.values()]);
  }

  // After layout settles, so geometry reads don't force a synchronous layout.
  private report(session: number, status: AgentStatus, current?: number, error?: string): void {
    const snap = this.snap;
    const laidOut = this.highlighter.whenLaidOut();
    this.sendChain = this.sendChain.then(async () => {
      await laidOut;
      if (!this.spec || this.spec.session !== session) return;
      const t0 = performance.now();
      const count = (snap?.ranges.length ?? 0) / 2;
      // Background refreshes (current !== undefined) with an unchanged count keep the old ticks.
      if (status !== 'indexing' && (current === undefined || count !== this.markedCount)) {
        this.markers.set(this.highlighter.markerFractions());
        this.markedCount = count;
        this.updateCurrentMarker();
      }
      this.d.report({
        t: 'agent.update', session, status, current, error,
        count, total: snap?.total ?? 0, truncated: snap?.truncated ?? false,
        firstVisible: this.firstVisible(),
        embeds: snap ? embedsOf(snap) : [],
      });
      this.indexer.addCost(performance.now() - t0);
    });
  }


  private rectOf(i: number): DOMRect | null {
    const f = this.snap?.fields.get(i);
    if (f) return this.overlay.rectOf(f) ?? f.el.getBoundingClientRect();
    return this.highlighter.rangeOf(i)?.getBoundingClientRect() ?? null;
  }

  private firstVisible(): number {
    const n = this.matchCount;
    if (!n) return -1;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const r = this.rectOf(mid);
      if (r && (r.width || r.height) && r.bottom < 0) lo = mid + 1; else hi = mid;
    }
    return lo < n ? lo : 0;
  }

  private setCurrentHighlight(i: number): void {
    const f = i >= 0 ? this.snap?.fields.get(i) : undefined;
    this.highlighter.setCurrent(f ? -1 : i);
    this.overlay.setCurrent(f ? i : -1);
  }

  // Reads geometry: only call once layout has settled (after navigation, or after laidOut).
  private updateCurrentMarker(): void {
    const r = this.current >= 0 ? this.rectOf(this.current) : null;
    const height = document.documentElement.scrollHeight;
    this.markers.setCurrent(r && height > innerHeight * 1.2 ? (r.top + scrollY) / height : null);
  }

  goto(session: number, index: number): { editable: boolean } {
    if (!this.spec || session !== this.spec.session || index < 0 || index >= this.matchCount) return { editable: false };
    this.current = index;
    cancelPulse();
    this.setCurrentHighlight(index);
    const avoidTop = this.d.avoidTop?.() ?? 0;
    const f = this.snap?.fields.get(index);
    if (f) {
      this.overlay.revealInField(f);
      const rect = () => this.overlay.rectOf(f) ?? f.el.getBoundingClientRect();
      if (scrollToRect(f.el, rect, { avoidTop })) pulse(rect(), this.colors.current, this.d.exclude);
      this.updateCurrentMarker();
      return { editable: this.isEditable(index) };
    }
    const r = this.highlighter.rangeOf(index);
    if (r) {
      const revealed = reveal(r.startContainer);
      if (revealed) this.highlighter.sync();
      const moved = !!r.startContainer.parentElement && scrollToRect(r.startContainer.parentElement, () => r.getBoundingClientRect(), { avoidTop });
      this.highlighter.sync();
      // Only after a jump: pulsing while stepping through visible matches is noise.
      if (moved || revealed) pulse(r.getBoundingClientRect(), this.colors.current, this.d.exclude);
      this.updateCurrentMarker();
    }
    return { editable: this.isEditable(index) };
  }

  clearCurrent(): void {
    this.current = -1;
    this.setCurrentHighlight(-1);
    this.markers.setCurrent(null);
  }

  isEditable(i: number): boolean {
    const f = this.snap?.fields.get(i);
    if (f) return isEditableField(f.el);
    return !!this.highlighter.rangeOf(i)?.startContainer.parentElement?.isContentEditable;
  }


  private anchorOf(i: number): Anchor | null {
    if (i < 0 || !this.snap) return null;
    const f = this.snap.fields.get(i);
    if (f) return { kind: 'field', el: f.el, offset: f.start };
    const r = this.highlighter.rangeOf(i);
    return r && r.startContainer instanceof Text ? { kind: 'node', node: r.startContainer, offset: r.startOffset } : null;
  }

  private resolve(a: Anchor): number {
    const snap = this.snap!;
    let off = -1;
    if (a.kind === 'offset') off = a.offset;
    else if (a.kind === 'field') {
      const seg = snap.model.segs.find((s) => s.kind === 'field' && s.el === a.el);
      if (seg) off = seg.start + a.offset;
    } else off = snap.model.offsetOfNode(a.node, a.offset);
    const n = this.matchCount;
    if (off < 0) return Math.min(Math.max(this.current, 0), n - 1);
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (snap.ranges[2 * mid]! < off) lo = mid + 1; else hi = mid; }
    return lo < n ? lo : 0;
  }


  snippets(start: number, limit: number): Snippet[] {
    const snap = this.snap;
    if (!snap) return [];
    const out: Snippet[] = [];
    for (let i = start; i < Math.min(this.matchCount, start + limit); i++) {
      const ctx = snippetAt(snap.model.text, snap.ranges[2 * i]!, snap.ranges[2 * i + 1]!);
      out.push({ frameId: -1, index: i, ...ctx, editable: this.isEditable(i) }); // frameId: stamped by the coordinator
    }
    return out;
  }

  texts(): string[] {
    const snap = this.snap;
    if (!snap) return [];
    const out: string[] = [];
    for (let i = 0; i < snap.ranges.length; i += 2) out.push(snap.model.text.slice(snap.ranges[i], snap.ranges[i + 1]));
    return out;
  }


  async replace(target: number | 'all', template: string): Promise<ReplaceResult> {
    const snap = this.snap;
    if (!snap || !this.spec) return { replaced: 0, skipped: 0 };
    const indices = target === 'all' ? Array.from({ length: this.matchCount }, (_, i) => i) : [target];
    const editable = indices.filter((i) => i < this.matchCount && this.isEditable(i));
    const skipped = indices.length - editable.length;
    if (!editable.length) return { replaced: 0, skipped };

    // Plan from this snapshot before awaiting: later snapshots may index differently.
    const plans = editable.map((i) => {
      const s = snap.ranges[2 * i]!, e = snap.ranges[2 * i + 1]!;
      const f = snap.fields.get(i);
      if (f) return { start: s, edit: { kind: 'field' as const, el: f.el, start: f.start, end: f.end, expected: snap.model.text.slice(s, e) } };
      const r = this.highlighter.rangeOf(i)?.cloneRange();
      return r ? { start: s, edit: { kind: 'text' as const, range: r, expected: r.toString() } } : null;
    }).filter((p) => p !== null);

    const values = await this.d.matcher.expand(snap.model.text, query(snap.spec), template, plans.map((p) => p.start));
    const edits: Edit[] = [];
    plans.forEach((p, k) => { const v = values[k]; if (v != null) edits.push({ ...p.edit, value: v }); });
    const { applied, stale } = applyEdits(edits, target !== 'all');

    // Text before the replacement is unchanged, so the next match starts after it.
    const first = plans[0];
    this.pendingAnchor = target === 'all' || !first ? null : { kind: 'offset', offset: first.start + (values[0]?.length ?? 0) };
    if (target === 'all') this.current = -1;
    const installed = new Promise<number>((resolve) => { this.onInstalled = resolve; });
    this.indexer.rebuild('mutation');
    const current = await Promise.race([installed, new Promise<number>((r) => setTimeout(() => r(-1), 5000))]);
    return { replaced: applied, skipped: skipped + stale, current: target === 'all' ? undefined : current };
  }
}
