import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPTIONS, type Query } from '../../src/core/query';
import { Coordinator, type AgentBus } from '../../src/content/top/coordinator';
import type { AgentRequest, AgentUpdate, CoordState } from '../../src/shared/messages';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

/** Fake frames: records requests, answers goto/snippets like agents would. */
function setup() {
  const sent: { frameId: number; req: AgentRequest }[] = [];
  const broadcasts: AgentRequest[] = [];
  const history: Query[] = [];
  const answer = (frameId: number, r: AgentRequest): unknown => {
    sent.push({ frameId, req: r });
    if (r.t === 'agent.goto') return { editable: frameId === 9 };
    if (r.t === 'agent.snippets') return Array.from({ length: r.limit }, (_, k) => ({ frameId: -1, index: r.start + k, before: '', match: `f${frameId}#${r.start + k}`, after: '', editable: false }));
    if (r.t === 'agent.replace') return { replaced: 1, skipped: 0, current: 4 };
    return true;
  };
  const bus: AgentBus = {
    request: (frameId, req) => Promise.resolve(answer(frameId, req as AgentRequest)) as never,
    broadcast: (req) => { broadcasts.push(req); },
  };
  const c = new Coordinator({ bus, settings: () => ({ ...DEFAULT_SETTINGS, debounceMs: 10 }), recordHistory: (q) => history.push(q) });
  // Fake frames announce their embed tokens: 'tN' is frame N.
  for (let n = 1; n < 10; n++) c.onEmbedded(`t${n}`, n);
  const session = () => {
    const s = [...sent].reverse().find((x) => x.req.t === 'agent.search');
    return s && s.req.t === 'agent.search' ? s.req.spec.session : -1;
  };
  const update = (frameId: number, p: Partial<AgentUpdate>) =>
    c.onUpdate({ t: 'agent.update', session: session(), status: 'done', count: 0, total: 0, truncated: false, firstVisible: 0, embeds: [], ...p }, frameId);
  const gotos = () => sent.filter((x) => x.req.t === 'agent.goto').map((x) => [x.frameId, x.req.t === 'agent.goto' ? x.req.index : -1]);
  const state = async (): Promise<CoordState> => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); return c.state; };
  return { c, sent, broadcasts, history, update, gotos, state, session };
}

const q = (pattern: string): Query => ({ ...DEFAULT_OPTIONS, pattern });

describe('Coordinator', () => {
  beforeEach(() => vi.useRealTimers());

  it('debounces typing and runs one search per settled query', () => {
    vi.useFakeTimers();
    const t = setup();
    t.c.open();
    t.c.setQuery(q('a'));
    t.c.setQuery(q('ab'));
    t.c.setQuery(q('abc'));
    expect(t.c.state.status).toBe('searching');
    vi.advanceTimersByTime(11);
    const searches = t.sent.filter((x) => x.req.t === 'agent.search');
    expect(searches).toHaveLength(1);
    expect(t.broadcasts.filter((r) => r.t === 'agent.search')).toHaveLength(1);
  });

  it('opening with a pre-filled query searches exactly once', () => {
    const t = setup();
    t.c.open(q('foo'));
    expect(t.sent.filter((x) => x.req.t === 'agent.search')).toHaveLength(1);
  });

  it('invalid pattern: reports the error, keeps previous results, and wins over late frame updates', async () => {
    const t = setup();
    t.c.open(q('ok'));
    t.update(0, { count: 3 });
    t.c.setQuery(q('(bad'), true);
    t.update(0, { count: 3 }); // late update from the previous (same) session
    const s = await t.state();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/Unterminated/);
    expect(s.total).toBe(3);
  });

  it('ignores updates from stale sessions', async () => {
    const t = setup();
    t.c.open(q('a'));
    const old = t.session();
    t.c.setQuery(q('b'), true);
    t.c.onUpdate({ t: 'agent.update', session: old, status: 'done', count: 99, total: 99, truncated: false, firstVisible: 0, embeds: [] }, 0);
    expect((await t.state()).total).toBe(0);
  });

  it('picks the first visible top-frame match initially, and waits for the top frame before falling back to iframes', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(7, { count: 2 });
    expect(t.gotos()).toEqual([]);
    t.update(0, { count: 5, firstVisible: 3, embeds: [['t7', 0]] });
    await t.state();
    expect(t.gotos()).toEqual([[0, 3]]);
    expect((await t.state()).current).toBe(5); // the iframe's 2 matches come first (it sits before them)
  });

  it('falls back to the first iframe with matches when the top frame has none', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 0, embeds: [['t7', 0]] });
    t.update(7, { count: 2 });
    await t.state();
    expect(t.gotos()).toEqual([[7, 0]]);
    expect(t.sent.some((x) => x.frameId === 0 && x.req.t === 'agent.scrollChildIntoView')).toBe(true);
  });

  it('next/prev walk frames in document order and wrap around', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 2, firstVisible: 0, embeds: [['t5', 2], ['t6', 2]] });
    t.update(5, { count: 0 });
    t.update(6, { count: 1 });
    await t.state();
    const steps: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) { t.c.next(); steps.push((await t.state()).current); }
    expect(steps).toEqual([1, 2, 0, 1]);
    t.c.prev(); t.c.prev();
    expect((await t.state()).current).toBe(2);
    expect(t.gotos().at(-1)).toEqual([6, 0]);
  });

  it('interleaves iframe matches at the iframe position in the parent (document order)', async () => {
    const t = setup();
    t.c.open(q('x'));
    // top: m0 <iframe 7> m1 m2 ; frame 7: n0 n1
    t.update(0, { count: 3, embeds: [['t7', 1]] });
    t.update(7, { count: 2 });
    expect(t.c.runs()).toEqual([{ frameId: 0, from: 0, to: 1 }, { frameId: 7, from: 0, to: 2 }, { frameId: 0, from: 1, to: 3 }]);
    const seen: string[] = [];
    await t.state();
    for (let i = 0; i < 5; i++) { t.c.next(); await t.state(); const g = t.gotos().at(-1)!; seen.push(`${g[0]}:${g[1]}`); }
    expect(seen).toEqual(['7:0', '7:1', '0:1', '0:2', '0:0']);
    const sn = await t.c.snippets(0, 5);
    expect(sn.items.map((x) => x.match)).toEqual(['f0#0', 'f7#0', 'f7#1', 'f0#1', 'f0#2']);
  });

  it('a frame whose token is not announced yet is placed last until it is', () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 2, embeds: [['tX', 1]] });
    t.update(42, { count: 1 });
    expect(t.c.order()).toEqual([0, 42]);
    t.c.onEmbedded('tX', 42);
    expect(t.c.runs().map((r) => r.frameId)).toEqual([0, 42, 0]);
  });

  it('nested frames: depth-first, each at its position; unembedded frames go last', () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 1, embeds: [['t5', 1], ['t6', 1]] });
    t.update(5, { count: 1, embeds: [['t8', 0]] });
    t.update(8, { count: 1 });
    t.update(6, { count: 1 });
    t.update(9, { count: 1 });
    expect(t.c.order()).toEqual([0, 8, 5, 6, 9]);
  });

  it('aggregates totals, truncation and indexing status', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 10, truncated: true, status: 'indexing', embeds: [['t5', 10]] });
    t.update(5, { count: 4 });
    const s = await t.state();
    expect(s).toMatchObject({ total: 14, truncated: true, status: 'indexing', frames: 2 });
  });

  it('snippets span frames with correct offsets and frame ids', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 2, embeds: [['t5', 2]] });
    t.update(5, { count: 3 });
    const r = await t.c.snippets(1, 3);
    expect(r.items.map((s) => [s.frameId, s.match])).toEqual([[0, 'f0#1'], [5, 'f5#0'], [5, 'f5#1']]);
  });

  it('single replace jumps to the match the agent reports after re-indexing', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 6 });
    await t.state();
    await t.c.replace('y', false);
    expect(t.gotos().at(-1)).toEqual([0, 4]);
  });

  it('records history once per query, only when results were used', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 3 });
    await t.state();
    t.c.next(); t.c.next(); t.c.next();
    t.c.setOpen(false);
    expect(t.history.map((h) => h.pattern)).toEqual(['x']);
  });

  it('closing stops all frames and clears state', async () => {
    const t = setup();
    t.c.open(q('x'));
    t.update(0, { count: 3 });
    t.c.setOpen(false);
    expect(t.broadcasts.at(-1)).toEqual({ t: 'agent.stop' });
    expect(t.sent.at(-1)).toMatchObject({ frameId: 0, req: { t: 'agent.stop' } });
    expect(await t.state()).toMatchObject({ open: false, status: 'idle', total: 0, current: -1 });
  });

  it('a late goto reply from an older navigation does not overwrite currentEditable', async () => {
    let release!: () => void;
    const t = setup();
    const slow = new Promise<void>((r) => { release = r; });
    const bus = (t.c as unknown as { d: { bus: AgentBus } }).d.bus;
    const orig = bus.request.bind(bus);
    bus.request = (async (f: number, req: AgentRequest) => {
      if (req.t === 'agent.goto' && f === 9) { await slow; return { editable: true }; }
      return orig(f, req as never);
    }) as AgentBus['request'];
    t.c.open(q('x'));
    t.update(0, { count: 1 });
    t.update(9, { count: 1 });
    const first = t.c.goto(9, 0);
    await t.c.goto(0, 0);
    release();
    await first;
    expect((await t.state()).currentEditable).toBe(false);
  });
});
