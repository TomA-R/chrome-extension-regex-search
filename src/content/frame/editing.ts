import type { FieldEl } from './dom-source';

// Captured before any async work, with the text it expects to replace.
export type Edit =
  | { kind: 'field'; el: FieldEl; start: number; end: number; expected: string; value: string }
  | { kind: 'text'; range: Range; expected: string; value: string };

export interface EditResult { applied: number; stale: number }

// execCommand keeps undo history and fires real input events, which frameworks listen to.
export function applyEdits(edits: Edit[], single: boolean): EditResult {
  let applied = 0, stale = 0;
  const active = document.activeElement;

  // Last-to-first per element so earlier offsets stay valid.
  const perField = new Map<FieldEl, Extract<Edit, { kind: 'field' }>[]>();
  for (const e of edits) if (e.kind === 'field') perField.set(e.el, [...(perField.get(e.el) ?? []), e]);
  for (const [el, list] of perField) {
    list.sort((a, b) => b.start - a.start);
    const ok = list.filter((e) => el.value.slice(e.start, e.end) === e.expected);
    stale += list.length - ok.length;
    if (!ok.length) continue;
    if (single && ok.length === 1) {
      const e = ok[0]!;
      el.focus();
      el.setSelectionRange(e.start, e.end);
      if (!document.execCommand('insertText', false, e.value)) setFieldValue(el, el.value.slice(0, e.start) + e.value + el.value.slice(e.end));
    } else {
      let v = el.value;
      for (const e of ok) v = v.slice(0, e.start) + e.value + v.slice(e.end);
      // One insertText over the whole value = one undo step.
      const { scrollTop, scrollLeft } = el;
      el.focus();
      el.select();
      if (!document.execCommand('insertText', false, v)) setFieldValue(el, v);
      el.scrollTop = scrollTop;
      el.scrollLeft = scrollLeft;
    }
    applied += ok.length;
  }

  const texts = edits.filter((e): e is Extract<Edit, { kind: 'text' }> => e.kind === 'text').reverse();
  const sel = getSelection();
  for (const e of texts) {
    if (e.range.toString() !== e.expected) { stale++; continue; }
    const host = e.range.startContainer.parentElement?.closest('[contenteditable]') as HTMLElement | null;
    host?.focus();
    sel?.removeAllRanges();
    sel?.addRange(e.range);
    if (!document.execCommand('insertText', false, e.value)) { e.range.deleteContents(); e.range.insertNode(document.createTextNode(e.value)); }
    applied++;
  }
  if (texts.length) sel?.removeAllRanges();
  if (active instanceof HTMLElement && active !== document.activeElement) active.focus();
  return { applied, stale };
}

// The native setter bypasses React's value tracker; events notify other frameworks.
export function setFieldValue(el: FieldEl, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function isEditableField(el: FieldEl): boolean {
  return !el.readOnly && !el.disabled;
}
