import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { PANEL_PORT, type CoordApi, type CoordState, type Method, type PanelPush, type Request, type Result, type Snippet } from '../../shared/messages';

export type Send = <K extends Method<CoordApi>>(msg: Request<CoordApi, K>) => Promise<Result<CoordApi, K> | null>;

export type Connection =
  | { kind: 'connecting' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; state: CoordState; send: Send };

export function useCoordinator(): Connection {
  const [tabId, setTabId] = useState<number>();
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<CoordState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const tabRef = useRef<number | undefined>(undefined);
  tabRef.current = tabId;

  useEffect(() => {
    const refresh = () => void chrome.tabs.query({ active: true, currentWindow: true }).then((t) => setTabId(t[0]?.id));
    const onUpdated = (id: number, info: { status?: string }) => { if (info.status === 'complete' && id === tabRef.current) setEpoch((e) => e + 1); };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(refresh); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, []);

  useEffect(() => {
    if (tabId === undefined) return;
    setState(null);
    setUnavailable(false);
    let port: chrome.runtime.Port;
    try { port = chrome.tabs.connect(tabId, { name: PANEL_PORT, frameId: 0 }); } catch { setUnavailable(true); return; }
    let got = false;
    port.onMessage.addListener((m: PanelPush) => { if (m.t === 'state') { got = true; setState(m.state); } });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (!got) setUnavailable(true); });
    return () => port.disconnect();
  }, [tabId, epoch]);

  const send = useCallback<Send>((msg) => {
    if (tabId === undefined) return Promise.resolve(null);
    return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => null) as never;
  }, [tabId]);

  if (unavailable) return { kind: 'unavailable' };
  return state ? { kind: 'ready', state, send } : { kind: 'connecting' };
}

export function useSnippetPages(send: Send, state: CoordState, first: number, last: number, pageSize = 100): Map<number, Snippet> {
  const resultKey = `${JSON.stringify(state.query)}|${state.total}|${state.status}`;
  const [cache, setCache] = useState(() => ({ key: resultKey, rows: new Map<number, Snippet>(), requested: new Set<number>() }));
  const current = cache.key === resultKey ? cache : { key: resultKey, rows: new Map<number, Snippet>(), requested: new Set<number>() };

  useEffect(() => {
    if (current !== cache) setCache(current);
    for (let p = Math.floor(first / pageSize) * pageSize; p < last; p += pageSize) {
      if (current.requested.has(p)) continue;
      current.requested.add(p);
      void send({ t: 'coord.snippets', offset: p, limit: pageSize }).then((r) => {
        if (!r) return;
        setCache((c) => {
          if (c.key !== current.key) return c; // indices refer to a different result set
          const rows = new Map(c.rows);
          r.items.forEach((s, k) => rows.set(p + k, s));
          return { ...c, rows };
        });
      });
    }
  }, [send, resultKey, first, last, pageSize]);

  return current.rows;
}

export function useToast(ms = 3000): [string, (s: string) => void] {
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), ms); return () => clearTimeout(t); }, [toast, ms]);
  return [toast, setToast];
}

export function useHeight<T extends HTMLElement>(ref: { current: T | null }, initial = 600): number {
  const [h, setH] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref.current]);
  return h;
}
