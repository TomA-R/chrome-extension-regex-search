import { collapse, collapseWithMap, NEEDS_COLLAPSE, WS_ONLY } from './whitespace';

// Block separators (`\n`, `\t`, ` `) are not segments and belong to no node.
export interface TextSegment<N, B> {
  kind: 'text';
  node: N;
  start: number;
  length: number;
  // Model->raw offsets (length + 1 entries); null = identity or not built yet (see mapOf).
  map: Int32Array | null;
  collapsed?: { keepNl: boolean; prevWs: boolean };
  block: B;
  ws: WsMode;
  sep: string;
}

// 0 = pre, 1 = normal, 2 = pre-line
export type WsMode = 0 | 1 | 2;

export interface FieldSegment<E> {
  kind: 'field';
  el: E;
  start: number;
  length: number;
  block: E;
  sep: string;
}

export type Segment<N, E, B> = TextSegment<N, B> | FieldSegment<E>;

export type Located<N, E> =
  | { kind: 'text'; startSeg: number; endSeg: number; startNode: N; startOffset: number; endNode: N; endOffset: number }
  | { kind: 'field'; seg: number; el: E; start: number; end: number };

export interface TextModelOptions<N, E = unknown> {
  rawText?: (node: N) => string;
  fieldValue?: (el: E) => string;
  alive?: (n: N | E) => boolean;
}

export interface RebuildOptions<N, E> {
  changed: ReadonlySet<N | E>;
  replace?: ReadonlyMap<N, N>;
  yieldIfNeeded?: () => Promise<void> | void;
}

export class TextModel<N = unknown, E = unknown, B = unknown> {
  constructor(private readonly opts: TextModelOptions<N, E> = {}) {}

  readonly segs: Segment<N, E, B>[] = [];
  readonly embeds: { el: B; offset: number; seg: number }[] = [];
  private pendingSep = '';
  private parts: string[] = [];
  private joined: string | null = '';
  private len = 0;
  private last = '\n';
  private trailingCollapsible = false;
  private fields = 0;

  get length(): number { return this.len; }
  get lastChar(): string { return this.last; }
  get hasFields(): boolean { return this.fields > 0; }

  get text(): string {
    if (this.joined === null) this.joined = this.parts.join('');
    return this.joined;
  }

  compact(): void { this.parts = [this.text]; }


  // Never emits two in a row; a newline upgrades a pending space/tab.
  separator(c: '\n' | '\t' | ' '): void {
    this.pendingSep += c;
    this.emitSep(c);
  }

  private emitSep(c: '\n' | '\t' | ' '): void {
    if (c !== ' ' && this.trailingCollapsible) this.trimTrailingSpace();
    if (this.last === '\n') return;
    if (c !== '\n' && (this.last === ' ' || this.last === '\t')) return;
    this.push(c);
  }

  appendText(node: N, s: string, map: Int32Array | null, block: B, collapsibleEnd = false, collapsed?: TextSegment<N, B>['collapsed']): void {
    this.pushText(node, s, map, block, collapsibleEnd ? 1 : 0, collapsed);
  }

  appendRaw(node: N, raw: string, block: B, ws: WsMode): void {
    if (ws === 0) { this.pushText(node, raw, null, block, 0); return; }
    const last = this.last;
    const prevWs = last === ' ' || last === '\n' || last === '\t';
    if ((prevWs && raw.charCodeAt(0) === 32) || NEEDS_COLLAPSE.test(raw)) {
      const keepNl = ws === 2;
      this.pushText(node, collapse(raw, keepNl, prevWs), null, block, ws, { keepNl, prevWs });
    } else {
      this.pushText(node, raw, null, block, ws);
    }
  }

  private pushText(node: N, s: string, map: Int32Array | null, block: B, ws: WsMode, collapsed?: TextSegment<N, B>['collapsed']): void {
    if (!s) return;
    const sep = this.takeSep();
    const seg: TextSegment<N, B> = { kind: 'text', node, start: this.len, length: s.length, map, block, ws, sep };
    if (collapsed) seg.collapsed = collapsed;
    this.segs.push(seg);
    this.push(s);
    this.trailingCollapsible = ws !== 0 && s.charCodeAt(s.length - 1) === 32;
  }

  appendField(el: E, value: string): void {
    const sep = this.takeSep();
    this.emitSep('\n');
    this.segs.push({ kind: 'field', el, start: this.len, length: value.length, block: el, sep });
    this.fields++;
    this.push(value);
    this.trailingCollapsible = false;
    this.emitSep('\n');
  }

  private takeSep(): string {
    const s = this.pendingSep;
    this.pendingSep = '';
    return s;
  }

  // Replays the recorded build without walking the DOM. The segment after a changed one is redone too,
  // since its leading-space collapse depends on it. Null means a full re-walk is needed.
  async rebuild(o: RebuildOptions<N, E>): Promise<TextModel<N, E, B> | null> {
    const { rawText, fieldValue, alive } = this.opts;
    if (!rawText || !fieldValue || !alive) return null;
    const m = new TextModel<N, E, B>(this.opts);
    const text = this.text;
    let e = 0;
    let redoNext = false;
    for (let i = 0; i < this.segs.length; i++) {
      if ((i & 255) === 255) await o.yieldIfNeeded?.();
      while (e < this.embeds.length && this.embeds[e]!.seg === i) m.addEmbed(this.embeds[e++]!.el);
      const s = this.segs[i]!;
      for (const c of s.sep) m.separator(c as '\n' | '\t' | ' ');
      if (s.kind === 'field') {
        if (!alive(s.el)) return null;
        m.appendField(s.el, o.changed.has(s.el) ? fieldValue(s.el) : text.slice(s.start, s.start + s.length));
        continue;
      }
      const node = o.replace?.get(s.node) ?? s.node;
      const changed = node !== s.node || o.changed.has(s.node);
      if (changed && !alive(node)) return null;
      const raw = changed ? rawText(node) : '';
      // Empty text changes which separators the walker emits, which depends on structure we don't keep.
      if (changed && (s.ws === 0 ? !raw : WS_ONLY.test(raw))) return null;
      const before = m.segs.length;
      if (changed || redoNext || m.last !== this.charBefore(s)) {
        m.appendRaw(node, changed ? raw : rawText(node), s.block, s.ws);
        redoNext = changed;
      } else {
        m.pushText(s.node, text.slice(s.start, s.start + s.length), s.map, s.block, s.ws, s.collapsed);
        redoNext = false;
      }
      if (m.segs.length === before) return null;
      if (changed) {
        // Following whitespace-only nodes were dropped or kept based on this text's last char.
        const oldEnd = text[s.start + s.length - 1];
        const isWs = (c: string | undefined) => c === ' ' || c === '\n' || c === '\t';
        if (isWs(oldEnd) !== isWs(m.last)) return null;
      }
    }
    while (e < this.embeds.length) m.addEmbed(this.embeds[e++]!.el);
    m.compact();
    return m;
  }

  private charBefore(s: Segment<N, E, B>): string {
    if (s.start === 0) return '\n';
    const c = this.text[s.start - 1]!;
    return c === ' ' || c === '\n' || c === '\t' ? c : 'x';
  }

  addEmbed(el: B): void {
    this.embeds.push({ el, offset: this.len, seg: this.segs.length });
  }

  private trimTrailingSpace(): void {
    this.trailingCollapsible = false;
    const seg = this.segs[this.segs.length - 1];
    if (!seg || seg.kind !== 'text' || seg.start + seg.length !== this.len) return;
    const i = this.parts.length - 1;
    this.parts[i] = this.parts[i]!.slice(0, -1);
    this.joined = null;
    this.len--;
    seg.length--;
    if (seg.map) seg.map = seg.map.subarray(0, seg.length + 1); // lazy maps are cut in mapOf
    if (!seg.length) this.segs.pop();
    const prev = this.parts[i] || this.parts[i - 1] || '';
    const c = prev[prev.length - 1];
    this.last = c === undefined || c === '\n' ? '\n' : c === ' ' || c === '\t' ? c : 'x';
  }

  private push(s: string): void {
    this.trailingCollapsible = false;
    this.parts.push(s);
    this.joined = null;
    this.len += s.length;
    const c = s[s.length - 1]!;
    this.last = c === ' ' || c === '\n' || c === '\t' ? c : 'x';
  }

  mapOf(seg: TextSegment<N, B>): Int32Array | null {
    if (seg.map || !seg.collapsed || !this.opts.rawText) return seg.map;
    const { map } = collapseWithMap(this.opts.rawText(seg.node), seg.collapsed.keepNl, seg.collapsed.prevWs);
    seg.map = map.length > seg.length + 1 ? map.subarray(0, seg.length + 1) : map;
    seg.collapsed = undefined;
    return seg.map;
  }

  firstSegEndingAfter(offset: number): number {
    let lo = 0, hi = this.segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segs[mid]!;
      if (s.start + s.length <= offset) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  lastSegStartingBefore(offset: number): number {
    let lo = 0, hi = this.segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segs[mid]!.start < offset) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
  }

  // A match starting in a field is clipped to it; a text match is clipped before any field.
  locate(start: number, end: number): Located<N, E> | null {
    const a = this.firstSegEndingAfter(start);
    const first = this.segs[a];
    if (!first || first.start >= end) return null;
    if (first.kind === 'field') {
      const s = Math.max(start, first.start) - first.start;
      const e = Math.min(end, first.start + first.length) - first.start;
      return { kind: 'field', seg: a, el: first.el, start: s, end: e };
    }
    let b = this.lastSegStartingBefore(end);
    for (let i = a + 1; i <= b; i++) if (this.segs[i]!.kind === 'field') { b = i - 1; break; }
    const last = this.segs[b] as TextSegment<N, B>;
    const rel0 = Math.max(0, start - first.start);
    const rel1 = Math.min(last.length, end - last.start);
    const m0 = this.mapOf(first), m1 = this.mapOf(last);
    return {
      kind: 'text',
      startSeg: a,
      endSeg: b,
      startNode: first.node,
      startOffset: m0 ? m0[Math.min(rel0, m0.length - 1)]! : rel0,
      endNode: last.node,
      endOffset: m1 ? m1[Math.min(rel1, m1.length - 1)]! : rel1,
    };
  }

  offsetOfNode(node: N, rawOffset = 0): number {
    for (const s of this.segs) {
      if (s.kind !== 'text' || s.node !== node) continue;
      const map = this.mapOf(s);
      if (!map) return s.start + Math.min(rawOffset, s.length);
      let i = 0;
      while (i < s.length && map[i + 1]! <= rawOffset) i++;
      return s.start + i;
    }
    return -1;
  }
}
