// Chrome content scripts lack runtime.getFrameId, so parent and child exchange a token via postMessage.
const TOKEN_KEY = '__rxEmbedToken';
const tokens = new WeakMap<Element, string>();
const byToken = new Map<string, WeakRef<Element>>();

export function embedToken(el: Element): string {
  let t = tokens.get(el);
  if (!t) {
    t = `rx-${crypto.randomUUID()}`;
    tokens.set(el, t);
    byToken.set(t, new WeakRef(el));
  }
  try { (el as HTMLIFrameElement).contentWindow?.postMessage({ [TOKEN_KEY]: t }, '*'); } catch { /* detached */ }
  return t;
}

export function iframeByToken(token: string): Element | null {
  return byToken.get(token)?.deref() ?? null;
}

// Installed by the bootstrap so no token is missed before the runtime loads.
export function listenForEmbedToken(cb: (token: string) => void): void {
  if (window.parent === window) return;
  let last = '';
  addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const t = (e.data as Record<string, unknown> | null)?.[TOKEN_KEY];
    if (typeof t !== 'string' || t === last) return;
    last = t;
    cb(t);
  });
}

// Includes iframes inside shadow roots.
export function hasChildFrames(): boolean {
  return window.length > 0;
}
