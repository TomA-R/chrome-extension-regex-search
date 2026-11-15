// Runs before page listeners: stops our UI's events from reaching page shortcuts, then re-dispatches them inside the shadow root.
const FORWARDED = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input'] as const;
const STOPPED = ['focusin', 'focusout', 'focus', 'blur', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend'] as const;

const targets = new Map<Element, ShadowRoot>();

export function installGuard(): void {
  for (const type of FORWARDED) addEventListener(type, forward, true);
  for (const type of STOPPED) addEventListener(type, stop, true);
}

export function guardHost(host: Element, root: ShadowRoot): void {
  targets.set(host, root);
}

export function unguardHost(host: Element): void {
  targets.delete(host);
}

function stop(e: Event): void {
  if (e.target instanceof Element && targets.has(e.target)) e.stopImmediatePropagation();
}

function forward(e: Event): void {
  const host = e.target instanceof Element ? e.target : null;
  const root = host && targets.get(host);
  if (!root) return;
  e.stopImmediatePropagation();
  const inner = root.activeElement;
  if (!inner) return;
  let clone: Event;
  if (e instanceof KeyboardEvent) {
    clone = new KeyboardEvent(e.type, {
      key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
      bubbles: true, cancelable: true, composed: false,
    });
  } else if (e instanceof InputEvent) {
    clone = new InputEvent(e.type, { data: e.data, inputType: e.inputType, isComposing: e.isComposing, bubbles: true, cancelable: e.cancelable, composed: false });
  } else {
    clone = new Event(e.type, { bubbles: true, cancelable: e.cancelable, composed: false });
  }
  if (!inner.dispatchEvent(clone)) e.preventDefault();
}
