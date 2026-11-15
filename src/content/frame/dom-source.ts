import { TextModel } from '../../core/text-model';
import { WS_ONLY } from '../../core/whitespace';
import { yieldToMain } from './scheduling';

export const DOM_MODEL_OPTIONS = {
  rawText: (n: Text) => n.data,
  fieldValue: (el: FieldEl) => el.value,
  alive: (n: Node) => n.isConnected,
};

export type DomModel = TextModel<Text, FieldEl, Element>;
export type FieldEl = HTMLInputElement | HTMLTextAreaElement;

// Site adapters (e.g. virtualized code views) can supply text that isn't in the DOM.
export interface TextSource {
  build(opts: BuildOptions): Promise<DomModel>;
}

export interface BuildOptions {
  searchFields: boolean;
  exclude: ReadonlySet<Element>;
  signal: AbortSignal;
  onSlice?: (model: DomModel) => void;
  sliceMs?: number;
  onShadowRoot?: (root: ShadowRoot) => void;
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'object', 'embed', 'select', 'head', 'title', 'canvas', 'video', 'audio', 'img', 'math']);
const INLINE_DISPLAYS = new Set(['inline', 'contents', 'ruby', 'ruby-text', 'ruby-base', 'ruby-text-container', 'ruby-base-container']);
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', '']);
const COLLAPSIBLE_WS = new Set(['collapse', 'normal', 'nowrap', 'preserve-breaks', 'pre-line']);

interface ElInfo {
  el: Element;
  textHidden: boolean;
  childrenHidden: boolean;
  untilFound: boolean;
  // Children other than <summary> are hidden but revealable.
  closedDetails: boolean;
  block: Element;
  // Atomic inline (inline-block, inline-flex...); blockOuter is the block containing it.
  blockAtomic: boolean;
  blockOuter: Element;
  cell: Element | null;
  style: CSSStyleDeclaration;
  ws: string | null;
}

const wsOf = (i: ElInfo): string => (i.ws ??= i.style.whiteSpaceCollapse || i.style.whiteSpace);

// Includes closed roots (via chrome.dom) for custom elements.
export function shadowRootOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  if (!el.localName.includes('-')) return null;
  try { return (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement)) ?? null; } catch { return null; }
}

export function flatParent(n: Node): Element | null {
  const slot = (n as Element | Text).assignedSlot;
  if (slot) return slot;
  const p = n.parentNode;
  if (!p) return null;
  if (p instanceof ShadowRoot) return p.host;
  return p instanceof Element ? p : null;
}

function childrenOf(el: Element): ArrayLike<Node> {
  if (el instanceof HTMLSlotElement) {
    const assigned = el.assignedNodes({ flatten: true });
    return assigned.length ? assigned : el.childNodes;
  }
  return el.childNodes;
}

function isSearchableField(el: Element): el is FieldEl {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

export class DomTextSource implements TextSource {
  constructor(private root: () => Element | null = () => document.body ?? document.documentElement) {}

  async build(opts: BuildOptions): Promise<DomModel> {
    const model: DomModel = new TextModel(DOM_MODEL_OPTIONS);
    const root = this.root();
    if (!root) return model;
    const sliceMs = opts.sliceMs ?? 8;

    const rootParent = flatParent(root);
    const rootInfo = this.info(root, rootParent ? this.info(rootParent, null) : null);
    if (!rootInfo) return model;

    type Frame = { list: ArrayLike<Node>; i: number; info: ElInfo; revealable: boolean };
    const stack: Frame[] = [{ list: shadowRootOf(root)?.childNodes ?? childrenOf(root), i: 0, info: rootInfo, revealable: false }];
    let prev: ElInfo | null = null;
    let deadline = performance.now() + sliceMs;
    let ops = 0;

    while (stack.length) {
      if ((++ops & 127) === 0 && performance.now() > deadline) {
        opts.onSlice?.(model);
        await yieldToMain();
        if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
        deadline = performance.now() + sliceMs;
      }
      const top = stack[stack.length - 1]!;
      if (top.i >= top.list.length) { stack.pop(); continue; }
      const n = top.list[top.i++]!;

      if (n.nodeType === Node.TEXT_NODE) {
        if (top.info.textHidden) continue;
        prev = this.emitText(model, n as Text, top.info, prev);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const tag = el.localName;
      if (SKIP_TAGS.has(tag) || opts.exclude.has(el)) continue;
      if (tag === 'iframe' || tag === 'frame') {
        // Searched by its own agent; record its position for global match order.
        if (!top.info.childrenHidden && this.info(el, top.info)) model.addEmbed(el);
        continue;
      }
      const revealable = top.revealable || (top.info.closedDetails && tag !== 'summary');
      if (top.info.childrenHidden && !revealable) continue;

      const info = this.info(el, top.info);
      if (!info) continue; // display:none subtree

      if (tag === 'input' || tag === 'textarea') {
        if (opts.searchFields && !info.textHidden && isSearchableField(el) && el.value) {
          model.appendField(el, el.value);
          prev = null;
        }
        continue;
      }
      if (tag === 'br' || tag === 'hr') { if (!info.textHidden) model.separator('\n'); continue; }

      const sr = shadowRootOf(el);
      if (sr) opts.onShadowRoot?.(sr);
      stack.push({ list: sr ? sr.childNodes : childrenOf(el), i: 0, info, revealable: revealable || info.untilFound });
    }
    model.compact();
    return model;
  }

  private info(el: Element, p: ElInfo | null): ElInfo | null {
    const s = getComputedStyle(el);
    const d = s.display;
    if (d === 'none') return null;
    const atomic = d.startsWith('inline-');
    const inline = !!p && INLINE_DISPLAYS.has(d);
    const block = inline ? p.block : el;
    // hidden=until-found is implemented as content-visibility:hidden; it is revealable, not hidden.
    const cvHidden = s.contentVisibility === 'hidden';
    const untilFound = cvHidden && el.getAttribute('hidden') === 'until-found';
    return {
      el,
      textHidden: s.visibility !== 'visible',
      childrenHidden: cvHidden && !untilFound,
      untilFound,
      closedDetails: el.localName === 'details' && !(el as HTMLDetailsElement).open,
      block,
      blockAtomic: inline ? p.blockAtomic : atomic,
      blockOuter: inline ? p.blockOuter : atomic && p ? p.block : el,
      cell: d === 'table-cell' ? el : d === 'table' || d === 'inline-table' || !p ? null : p.cell,
      style: s,
      ws: null,
    };
  }

  private emitText(model: DomModel, node: Text, pi: ElInfo, prev: ElInfo | null): ElInfo | null {
    const raw = node.data;
    if (!raw) return prev;
    const ws = wsOf(pi);
    const collapsible = COLLAPSIBLE_WS.has(ws);
    // Whitespace-only text at a block boundary renders nothing: don't let it emit a separator.
    if (collapsible && (!prev || pi.block !== prev.block) && WS_ONLY.test(raw)) return prev;
    if (prev && pi.block !== prev.block) {
      if (pi.cell && prev.cell && pi.cell !== prev.cell && pi.cell.parentElement === prev.cell.parentElement) model.separator('\t');
      else if ((pi.blockAtomic || prev.blockAtomic) && (pi.blockOuter === prev.blockOuter || pi.blockOuter === prev.block || prev.blockOuter === pi.block)) model.separator(' ');
      else model.separator('\n');
    }
    const before = model.segs.length;
    model.appendRaw(node, raw, pi.block, !collapsible ? 0 : ws === 'preserve-breaks' || ws === 'pre-line' ? 2 : 1);
    if (model.segs.length === before) return prev; // collapsed to nothing
    return pi;
  }
}
