import { MATCHER_PORT, type MatcherRequest, type MatcherResponse } from '../../shared/messages';

export interface MatchResult { ranges: number[]; total: number; truncated: boolean; ms: number }
export interface MatchQuery { source: string; flags: string; max: number; timeoutMs: number }

export class MatcherError extends Error {
  constructor(readonly kind: 'timeout' | 'syntax' | 'internal' | 'superseded' | 'disconnected', message: string) { super(message); }
}

export interface Matcher {
  search(text: string, q: MatchQuery): Promise<MatchResult>;
  expand(text: string, q: MatchQuery, template: string, starts: number[]): Promise<(string | null)[]>;
  dispose(): void;
}

type Waiter = { resolve: (r: MatcherResponse) => void; reject: (e: MatcherError) => void; timer: ReturnType<typeof setTimeout> };

// Compares 4 KB chunks first: native string equality is ~memcmp speed.
export function diffRange(a: string, b: string): { start: number; end: number; insert: string } {
  const CH = 4096;
  const min = Math.min(a.length, b.length);
  let p = 0;
  while (p + CH <= min && a.slice(p, p + CH) === b.slice(p, p + CH)) p += CH;
  while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let q = 0; // common suffix, not overlapping the prefix
  const maxQ = min - p;
  while (q + CH <= maxQ && a.slice(a.length - q - CH, a.length - q) === b.slice(b.length - q - CH, b.length - q)) q += CH;
  while (q < maxQ && a.charCodeAt(a.length - 1 - q) === b.charCodeAt(b.length - 1 - q)) q++;
  return { start: p, end: a.length - q, insert: b.slice(p, b.length - q) };
}

const BACKSTOP_MS = 3000;

export class OffscreenMatcher implements Matcher {
  private port: chrome.runtime.Port | null = null;
  private connecting: Promise<chrome.runtime.Port> | null = null;
  private waiters = new Map<number, Waiter>();
  private nextId = 1;
  private gen = 0;
  private hostText: string | null = null;

  private async connect(): Promise<chrome.runtime.Port> {
    if (this.port) return this.port;
    this.connecting ??= (async () => {
      const ok: unknown = await chrome.runtime.sendMessage({ t: 'bg.ensureOffscreen' });
      if (ok !== true) throw new MatcherError('internal', `offscreen unavailable: ${JSON.stringify(ok)}`);
      const port = chrome.runtime.connect({ name: MATCHER_PORT });
      port.onMessage.addListener((m: MatcherResponse) => {
        const w = this.waiters.get(m.id);
        if (!w) return;
        this.waiters.delete(m.id);
        clearTimeout(w.timer);
        if (m.op === 'error') w.reject(new MatcherError(m.kind, m.message)); else w.resolve(m);
      });
      port.onDisconnect.addListener(() => this.dropPort('disconnected'));
      this.port = port;
      this.hostText = null;
      return port;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private dropPort(kind: 'disconnected'): void {
    this.port = null;
    this.hostText = null;
    for (const w of this.waiters.values()) { clearTimeout(w.timer); w.reject(new MatcherError(kind, 'matcher disconnected')); }
    this.waiters.clear();
  }

  private sync(port: chrome.runtime.Port, text: string): void {
    const have = this.hostText;
    if (have === text) return;
    const d = have === null ? null : diffRange(have, text);
    if (d && d.start === have!.length) {
      port.postMessage({ op: 'append', gen: this.gen, chunk: text.slice(have!.length) } satisfies MatcherRequest);
    } else if (d && d.insert.length + (d.end - d.start) < text.length / 2) {
      port.postMessage({ op: 'splice', gen: this.gen, start: d.start, end: d.end, insert: d.insert } satisfies MatcherRequest);
    } else {
      this.gen++;
      port.postMessage({ op: 'reset', gen: this.gen } satisfies MatcherRequest);
      if (text) port.postMessage({ op: 'append', gen: this.gen, chunk: text } satisfies MatcherRequest);
    }
    this.hostText = text;
  }

  // One synchronous step after connecting so sync and request can't straddle a reconnect.
  private async call(text: string, timeoutMs: number, build: (id: number, gen: number) => MatcherRequest): Promise<MatcherResponse> {
    const port = await this.connect();
    if (port !== this.port) throw new MatcherError('disconnected', 'matcher disconnected');
    this.sync(port, text);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new MatcherError('timeout', 'matcher did not answer'));
      }, timeoutMs + BACKSTOP_MS);
      this.waiters.set(id, { resolve, reject, timer });
      port.postMessage(build(id, this.gen));
    });
  }

  async search(text: string, q: MatchQuery): Promise<MatchResult> {
    const r = await this.call(text, q.timeoutMs, (id, gen) => ({ op: 'search', id, gen, ...q }));
    if (r.op !== 'result') throw new MatcherError('internal', 'unexpected response');
    return r;
  }

  async expand(text: string, q: MatchQuery, template: string, starts: number[]): Promise<(string | null)[]> {
    const r = await this.call(text, q.timeoutMs, (id, gen) => ({ op: 'expand', id, gen, source: q.source, flags: q.flags, template, starts, timeoutMs: q.timeoutMs }));
    if (r.op !== 'expanded') throw new MatcherError('internal', 'unexpected response');
    return r.values;
  }

  dispose(): void {
    const p = this.port;
    this.dropPort('disconnected');
    p?.disconnect();
  }
}
