import { TextModel } from '../../core/text-model';
import type { DomModel, FieldEl, TextSource } from './dom-source';
import { slicer } from './scheduling';

export interface IndexerDeps {
  source: TextSource;
  exclude: ReadonlySet<Element>;
  onModel(model: DomModel, final: boolean, reason: BuildReason): void;
}

export type BuildReason = 'query' | 'mutation';

const PARTIAL_EVERY_MS = 150;
const OBSERVE: MutationObserverInit = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'style', 'class'] };

export class Indexer {
  private model: DomModel | null = null;
  private dirty = true;
  private building: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleMs = 50;
  private mo: MutationObserver;
  private observed = new WeakSet<Node>();
  private active = false;
  private searchFields = true;
  private changed = new Set<Node>();
  private removedText = new Map<Node, Element>();
  private addedText = new Set<Node>();
  private structural = true;
  private nodeSets = new WeakMap<DomModel, WeakSet<Node>>();

  constructor(private d: IndexerDeps) {
    this.mo = new MutationObserver((records) => {
      let any = false;
      for (const r of records) {
        if (this.isOurs(r)) continue;
        any = true;
        if (r.type === 'characterData' && r.target.nodeType === Node.TEXT_NODE) this.changed.add(r.target);
        else if (r.type === 'childList' && r.target instanceof Element && onlyText(r.addedNodes) && onlyText(r.removedNodes)) {
          // `el.textContent = ...` / `el.innerText = ...`: text children replaced, no elements involved.
          for (const n of r.removedNodes) this.removedText.set(n, r.target);
          for (const n of r.addedNodes) this.addedText.add(n);
        } else this.structural = true;
      }
      if (any) this.markDirty();
    });
  }

  get fresh(): DomModel | null { return this.dirty ? null : this.model; }

  activate(searchFields: boolean): void {
    if (searchFields !== this.searchFields) { this.searchFields = searchFields; this.dirty = true; this.structural = true; }
    if (this.active) return;
    this.active = true;
    this.dirty = true;
    this.structural = true;
    this.observe(document);
    addEventListener('input', this.onFieldInput, true);
  }

  deactivate(): void {
    this.active = false;
    this.building?.abort();
    this.building = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.mo.disconnect();
    this.observed = new WeakSet();
    removeEventListener('input', this.onFieldInput, true);
    this.model = null;
    this.dirty = true;
  }

  addCost(ms: number): void { this.cycleMs += ms; }

  rebuild(reason: BuildReason = 'query'): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void this.build(reason);
  }

  private observe(n: Node): void {
    if (this.observed.has(n)) return;
    this.observed.add(n);
    this.mo.observe(n, OBSERVE);
  }

  private isOurs(r: MutationRecord): boolean {
    const ex = this.d.exclude;
    const within = (n: Node) => { for (const h of ex) if (h === n || h.contains(n)) return true; return false; };
    if (within(r.target)) return true;
    // Adding/removing one of our hosts is a childList record on its parent. Recognise hosts by tag:
    // a removed host has usually left `exclude` by the time the record is delivered.
    if (r.type === 'childList') {
      const nodes = [...r.addedNodes, ...r.removedNodes];
      return nodes.length > 0 && nodes.every(isOurHost);
    }
    return false;
  }

  private onFieldInput = (e: Event): void => {
    const t = e.target;
    if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && !this.d.exclude.has(t)) {
      this.changed.add(t);
      this.markDirty();
    }
  };

  private markDirty(): void {
    if (!this.active) return;
    this.dirty = true;
    // While building, the in-flight build may already have passed the change: rebuild afterwards.
    if (this.timer || this.building) return;
    this.schedule();
  }

  private schedule(): void {
    // Keep re-indexing to <= ~10% of main-thread time on constantly mutating pages.
    const delay = Math.min(5000, Math.max(250, this.cycleMs * 10));
    this.timer = setTimeout(() => { this.timer = null; void this.build('mutation'); }, delay);
  }

  private patchPlan(changed: Set<Node>, removed: Map<Node, Element>, added: Set<Node>): Map<Text, Text> | null {
    const model = this.model;
    if (!model || (!changed.size && !removed.size)) return null;
    let nodes = this.nodeSets.get(model);
    if (!nodes) {
      nodes = new WeakSet();
      for (const s of model.segs) nodes.add(s.kind === 'text' ? s.node : s.el);
      this.nodeSets.set(model, nodes);
    }
    for (const n of changed) if (!nodes.has(n) && !added.has(n)) return null;
    const replace = new Map<Text, Text>();
    const used = new Set<Node>();
    for (const [old, parent] of removed) {
      if (!nodes.has(old)) { if (added.has(old)) continue; return null; } // was it ever rendered? unknown
      const only = parent.childNodes.length === 1 ? parent.firstChild : null;
      if (!only || only.nodeType !== Node.TEXT_NODE || !parent.isConnected || used.has(only)) return null;
      replace.set(old as Text, only as Text);
      used.add(only);
    }
    for (const n of added) if (!used.has(n) && n.isConnected) return null; // new text we never indexed
    return replace;
  }

  private async build(reason: BuildReason): Promise<void> {
    if (!this.active) return;
    if (this.building) { this.building.abort(); this.structural = true; } // its captured changes are lost
    const ac = new AbortController();
    this.building = ac;
    this.dirty = false;
    const changed = this.changed, structural = this.structural, removed = this.removedText, added = this.addedText;
    this.changed = new Set();
    this.removedText = new Map();
    this.addedText = new Set();
    this.structural = false;
    const t0 = performance.now();
    let lastPartial = t0;
    try {
      const plan = reason === 'mutation' && !structural ? this.patchPlan(changed, removed, added) : null;
      if (plan) {
        const s = slicer(8, ac.signal);
        const patched = await this.model!.rebuild({ changed: changed as Set<Text | FieldEl>, replace: plan, yieldIfNeeded: () => s.tick() });
        if (ac.signal.aborted) return;
        if (patched) {
          // Same nodes plus the replacements: reuse the set instead of rebuilding it per cycle.
          const nodes = this.nodeSets.get(this.model!);
          if (nodes) { for (const n of plan.values()) nodes.add(n); this.nodeSets.set(patched, nodes); }
          this.model = patched;
          this.cycleMs = performance.now() - t0;
          this.d.onModel(patched, true, reason);
          return;
        }
      }
      const model = await this.d.source.build({
        searchFields: this.searchFields,
        exclude: this.d.exclude,
        signal: ac.signal,
        onShadowRoot: (sr) => this.observe(sr),
        onSlice: (m) => {
          // Early results on big pages; not for background rebuilds, whose old results stay valid.
          const now = performance.now();
          if (reason !== 'query' || now - lastPartial < PARTIAL_EVERY_MS) return;
          lastPartial = now;
          this.d.onModel(m, false, reason);
        },
      });
      if (ac.signal.aborted) return;
      this.model = model;
      this.cycleMs = performance.now() - t0;
      this.d.onModel(model, true, reason);
    } catch (e) {
      // Never wedge the UI at "searching": report an empty final model.
      if ((e as Error).name === 'AbortError') return;
      console.error('[regex-find] indexing failed', e);
      if (!ac.signal.aborted) this.d.onModel(new TextModel(), true, reason);
    } finally {
      if (this.building === ac) {
        this.building = null;
        if (this.dirty && this.active && !this.timer) this.schedule();
      }
    }
  }
}

function onlyText(list: NodeList): boolean {
  for (const n of list) if (n.nodeType !== Node.TEXT_NODE) return false;
  return true;
}

const isOurHost = (n: Node): boolean => n instanceof Element && n.localName.startsWith('rx-find-');
