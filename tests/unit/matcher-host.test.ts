import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/matcher/engine';
import { Session, type PortLike } from '../../src/matcher/host';
import type { MatcherRequest, MatcherResponse } from '../../src/shared/messages';

/** In-process Worker double running the real engine; can be told to "hang" (simulating backtracking). */
class FakeWorker {
  static spawned: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  hang = false;
  received: MatcherRequest[] = [];
  private engine = createEngine((m) => queueMicrotask(() => !this.terminated && this.onmessage?.({ data: m } as MessageEvent)));
  constructor() { FakeWorker.spawned.push(this); }
  postMessage(m: MatcherRequest) {
    this.received.push(m);
    if (this.hang && (m.op === 'search' || m.op === 'expand')) return;
    this.engine(m);
  }
  terminate() { this.terminated = true; }
}

function setup(now: () => number = () => 0) {
  const out: MatcherResponse[] = [];
  let onMsg!: (m: MatcherRequest) => void;
  let onDisc!: () => void;
  const port: PortLike = {
    postMessage: (m) => out.push(m),
    onMessage: { addListener: (fn) => { onMsg = fn; } },
    onDisconnect: { addListener: (fn) => { onDisc = fn; } },
  };
  new Session(port, () => new FakeWorker() as unknown as Worker, now);
  return { out, send: (m: MatcherRequest) => onMsg(m), disconnect: () => onDisc() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('matcher host session', () => {
  beforeEach(() => { FakeWorker.spawned = []; });
  afterEach(() => { vi.useRealTimers(); });

  it('streams text in chunks and searches the concatenation (matches across chunk boundaries)', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'hello wo' });
    s.send({ op: 'append', gen: 1, chunk: 'rld, world' });
    s.send({ op: 'search', id: 1, gen: 1, source: 'world', flags: 'g', max: 10, timeoutMs: 1000 });
    await flush();
    expect(s.out).toMatchObject([{ op: 'result', id: 1, ranges: [6, 11, 13, 18], total: 2, truncated: false }]);
  });

  it('caps stored ranges but counts all matches', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'aaaaa' });
    s.send({ op: 'search', id: 1, gen: 1, source: 'a', flags: 'g', max: 2, timeoutMs: 1000 });
    await flush();
    expect(s.out[0]).toMatchObject({ ranges: [0, 1, 1, 2], total: 5, truncated: true });
  });

  it('ignores appends from a stale generation', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 2 });
    s.send({ op: 'append', gen: 1, chunk: 'old' });
    s.send({ op: 'append', gen: 2, chunk: 'new' });
    s.send({ op: 'search', id: 1, gen: 2, source: 'old|new', flags: 'g', max: 10, timeoutMs: 1000 });
    await flush();
    expect(s.out[0]).toMatchObject({ ranges: [0, 3] });
  });

  it('times out a hung search, kills the worker, and replays the text into a fresh one', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'abc abc' });
    FakeWorker.spawned[0]!.hang = true;
    s.send({ op: 'search', id: 7, gen: 1, source: 'x', flags: 'g', max: 10, timeoutMs: 300 });
    vi.advanceTimersByTime(301);
    expect(s.out).toMatchObject([{ op: 'error', id: 7, kind: 'timeout' }]);
    expect(FakeWorker.spawned[0]!.terminated).toBe(true);
    expect(FakeWorker.spawned).toHaveLength(2);
    expect(FakeWorker.spawned[1]!.received).toEqual([{ op: 'reset', gen: 1 }, { op: 'append', gen: 1, chunk: 'abc abc' }]);
    vi.useRealTimers();
    s.send({ op: 'search', id: 8, gen: 1, source: 'abc', flags: 'g', max: 10, timeoutMs: 300 });
    await flush();
    expect(s.out[1]).toMatchObject({ op: 'result', id: 8, total: 2 });
  });

  it('a newer search kills a long-running one (> 100ms) and every request gets exactly one reply', async () => {
    let t = 0;
    const s = setup(() => t);
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'abc' });
    FakeWorker.spawned[0]!.hang = true;
    s.send({ op: 'search', id: 1, gen: 1, source: 'a', flags: 'g', max: 10, timeoutMs: 5000 });
    t = 150;
    s.send({ op: 'search', id: 2, gen: 1, source: 'b', flags: 'g', max: 10, timeoutMs: 5000 });
    await flush();
    expect(FakeWorker.spawned[0]!.terminated).toBe(true);
    expect(s.out).toMatchObject([{ op: 'error', id: 1, kind: 'superseded' }, { op: 'result', id: 2, ranges: [1, 2] }]);
  });

  it('a healthy running search is not killed: newer ones queue, and only the newest queued search runs', async () => {
    const t = 0;
    const s = setup(() => t);
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'abc' });
    s.send({ op: 'search', id: 1, gen: 1, source: 'a', flags: 'g', max: 10, timeoutMs: 5000 });
    s.send({ op: 'search', id: 2, gen: 1, source: 'b', flags: 'g', max: 10, timeoutMs: 5000 });
    s.send({ op: 'search', id: 3, gen: 1, source: 'c', flags: 'g', max: 10, timeoutMs: 5000 });
    await flush(); await flush();
    expect(FakeWorker.spawned).toHaveLength(1);
    expect(s.out.map((m) => [m.id, m.op])).toEqual([[2, 'error'], [1, 'result'], [3, 'result']]);
  });

  it('a search never kills a pending replace expansion (it queues behind it)', async () => {
    let t = 0;
    const s = setup(() => t);
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'a=1' });
    s.send({ op: 'expand', id: 1, gen: 1, source: '(\\w)=(\\d)', flags: 'g', template: '$2', starts: [0], timeoutMs: 5000 });
    t = 500;
    s.send({ op: 'search', id: 2, gen: 1, source: 'a', flags: 'g', max: 10, timeoutMs: 5000 });
    await flush(); await flush();
    expect(s.out).toMatchObject([{ op: 'expanded', id: 1, values: ['1'] }, { op: 'result', id: 2 }]);
  });

  it('a text reset answers pending and queued requests as superseded', () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    FakeWorker.spawned[0]!.hang = true;
    s.send({ op: 'search', id: 1, gen: 1, source: 'a', flags: 'g', max: 10, timeoutMs: 5000 });
    s.send({ op: 'expand', id: 2, gen: 1, source: 'a', flags: 'g', template: '', starts: [], timeoutMs: 5000 });
    s.send({ op: 'reset', gen: 2 });
    expect(s.out.map((m) => [m.id, m.op === 'error' && m.kind])).toEqual([[2, 'superseded'], [1, 'superseded']]);
  });

  it('the worker rejects requests for a stale generation', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 2 });
    s.send({ op: 'search', id: 1, gen: 1, source: 'a', flags: 'g', max: 10, timeoutMs: 5000 });
    await flush();
    expect(s.out[0]).toMatchObject({ op: 'error', kind: 'superseded' });
  });

  it('expands replacement templates anchored at match starts', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'a=1 b=2' });
    s.send({ op: 'expand', id: 3, gen: 1, source: '(\\w)=(\\d)', flags: 'g', template: '$2:$1', starts: [0, 4, 1], timeoutMs: 1000 });
    await flush();
    expect(s.out[0]).toEqual({ op: 'expanded', id: 3, values: ['1:a', '2:b', null] });
  });

  it('reports syntax errors instead of throwing', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'search', id: 1, gen: 1, source: '(', flags: 'g', max: 10, timeoutMs: 1000 });
    await flush();
    expect(s.out[0]).toMatchObject({ op: 'error', id: 1, kind: 'syntax' });
  });

  it('terminates the worker when the frame disconnects', () => {
    const s = setup();
    s.disconnect();
    expect(FakeWorker.spawned[0]!.terminated).toBe(true);
  });
});

describe('splice protocol', () => {
  beforeEach(() => { FakeWorker.spawned = []; });
  it('host and worker apply a mid-text splice; offsets after it shift', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'time 09 then x' });
    s.send({ op: 'splice', gen: 1, start: 5, end: 7, insert: '10:42' });
    s.send({ op: 'search', id: 1, gen: 1, source: '\\d+:\\d+|x', flags: 'g', max: 10, timeoutMs: 1000 });
    await flush();
    expect(s.out[0]).toMatchObject({ ranges: [5, 10, 16, 17] });
    FakeWorker.spawned[0]!.hang = true;
    vi.useFakeTimers();
    s.send({ op: 'search', id: 2, gen: 1, source: 'x', flags: 'g', max: 10, timeoutMs: 100 });
    vi.advanceTimersByTime(101);
    vi.useRealTimers();
    expect(FakeWorker.spawned[1]!.received.at(-1)).toEqual({ op: 'append', gen: 1, chunk: 'time 10:42 then x' });
  });
});

describe('worker crash', () => {
  beforeEach(() => { FakeWorker.spawned = []; });

  it('answers the running request, respawns with the text, and still runs queued requests', async () => {
    const s = setup();
    s.send({ op: 'reset', gen: 1 });
    s.send({ op: 'append', gen: 1, chunk: 'abc' });
    FakeWorker.spawned[0]!.hang = true;
    s.send({ op: 'expand', id: 1, gen: 1, source: 'a', flags: 'g', template: 'x', starts: [0], timeoutMs: 5000 });
    s.send({ op: 'search', id: 2, gen: 1, source: 'b', flags: 'g', max: 10, timeoutMs: 5000 });
    FakeWorker.spawned[0]!.onerror?.({ message: 'boom' } as ErrorEvent);
    await flush(); await flush();
    expect(s.out).toMatchObject([{ op: 'error', id: 1, kind: 'internal', message: 'boom' }, { op: 'result', id: 2, ranges: [1, 2] }]);
    expect(FakeWorker.spawned).toHaveLength(2);
  });
});
