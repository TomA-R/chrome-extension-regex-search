// Shared by the bootstrap and the lazily loaded runtime: separate bundles, same isolated world.
export interface RuntimeApi {
  onMessage(msg: unknown, reply: (r: unknown) => void): boolean;
  onConnect(port: chrome.runtime.Port): void;
}

export interface Bridge {
  runtime: RuntimeApi | null;
  guard: { add(host: Element, root: ShadowRoot): void; remove(host: Element): void };
  embedToken: string | null;
  onEmbedToken: ((token: string) => void) | null;
}

const KEY = '__rxFindBridge';

export function bridge(): Bridge {
  const g = globalThis as unknown as Record<string, Bridge | undefined>;
  return (g[KEY] ??= { runtime: null, guard: { add() {}, remove() {} }, embedToken: null, onEmbedToken: null });
}
