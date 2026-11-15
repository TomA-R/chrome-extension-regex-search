// Bundled (IIFE) and injected into plain test pages: real browser, real layout, no extension.
import { Agent } from '../../src/content/frame/agent';
import { DomTextSource } from '../../src/content/frame/dom-source';
import { Highlighter } from '../../src/content/frame/highlighter';
import type { Matcher, MatchQuery } from '../../src/content/frame/matcher-client';
import { MatcherError } from '../../src/content/frame/matcher-client';
import { TextModel } from '../../src/core/text-model';
import { createEngine } from '../../src/matcher/engine';
import type { MatcherResponse } from '../../src/shared/messages';

/** The real engine, in-process (no offscreen document): counts calls so tests can assert on them. */
class InProcessMatcher implements Matcher {
  calls = { search: 0, expand: 0, dispose: 0 };
  delayMs = 0;
  private last: MatcherResponse | null = null;
  private engine = createEngine((m) => { this.last = m; });
  private gen = 0;
  private text: string | null = null;
  private feed(text: string) {
    if (text === this.text) return;
    this.engine({ op: 'reset', gen: ++this.gen });
    this.engine({ op: 'append', gen: this.gen, chunk: text });
    this.text = text;
  }
  private async run(req: Parameters<ReturnType<typeof createEngine>>[0]) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    this.engine(req);
    const r = this.last!;
    if (r.op === 'error') throw new MatcherError(r.kind, r.message);
    return r;
  }
  async search(text: string, q: MatchQuery) {
    this.calls.search++;
    this.feed(text);
    const r = await this.run({ op: 'search', id: 1, gen: this.gen, ...q });
    if (r.op !== 'result') throw new Error('bad');
    return r;
  }
  async expand(text: string, q: MatchQuery, template: string, starts: number[]) {
    this.calls.expand++;
    this.feed(text);
    const r = await this.run({ op: 'expand', id: 1, gen: this.gen, source: q.source, flags: q.flags, template, starts, timeoutMs: q.timeoutMs });
    if (r.op !== 'expanded') throw new Error('bad');
    return r.values;
  }
  dispose() { this.calls.dispose++; this.text = null; }
}

Object.assign(window, { __rx: { Agent, DomTextSource, Highlighter, TextModel, InProcessMatcher } });
