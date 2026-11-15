// One worker per frame. Requests run one at a time and each gets exactly one reply.
import { MATCHER_PORT, type MatcherRequest, type MatcherResponse } from '../shared/messages';

const KILL_AFTER_MS = 100;

type Job = Extract<MatcherRequest, { op: 'search' | 'expand' }>;
type Running = { job: Job; started: number; timer: ReturnType<typeof setTimeout> };

export interface PortLike {
  postMessage(m: MatcherResponse): void;
  onMessage: { addListener(fn: (m: MatcherRequest) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export class Session {
  private worker: Worker;
  private gen = -1;
  private chunks: string[] = [];
  private running: Running | null = null;
  private queue: Job[] = [];
  private closed = false;

  constructor(private port: PortLike, private spawn: () => Worker, private now: () => number = () => performance.now()) {
    this.worker = this.start();
    port.onMessage.addListener((m: MatcherRequest) => this.onRequest(m));
    port.onDisconnect.addListener(() => {
      this.closed = true;
      if (this.running) clearTimeout(this.running.timer);
      this.running = null;
      this.queue = [];
      this.chunks = [];
      this.worker.terminate();
    });
  }

  private start(): Worker {
    const w = this.spawn();
    w.onmessage = (e: MessageEvent<MatcherResponse>) => {
      if (!this.running || e.data.id !== this.running.job.id) return;
      clearTimeout(this.running.timer);
      this.running = null;
      this.send(e.data);
      this.next();
    };
    w.onerror = (e) => {
      if (!this.running) return;
      this.kill('internal', e.message || 'worker error');
      this.next();
    };
    return w;
  }

  private kill(kind: 'timeout' | 'internal' | 'superseded', message: string): void {
    const r = this.running;
    this.running = null;
    if (r) { clearTimeout(r.timer); this.send({ op: 'error', id: r.job.id, kind, message }); }
    this.worker.terminate();
    this.worker = this.start();
    this.worker.postMessage({ op: 'reset', gen: this.gen } satisfies MatcherRequest);
    if (this.chunks.length) this.worker.postMessage({ op: 'append', gen: this.gen, chunk: this.chunks.join('') } satisfies MatcherRequest);
  }

  private send(m: MatcherResponse): void {
    if (this.closed) return;
    try { this.port.postMessage(m); } catch { /* frame gone */ }
  }

  private run(job: Job): void {
    const timer = setTimeout(() => {
      this.kill('timeout', `Pattern took longer than ${job.timeoutMs} ms`);
      this.next();
    }, job.timeoutMs);
    this.running = { job, started: this.now(), timer };
    this.worker.postMessage(job);
  }

  private next(): void {
    const job = this.queue.shift();
    if (job) this.run(job);
  }

  private onRequest(m: MatcherRequest): void {
    switch (m.op) {
      case 'reset':
        this.gen = m.gen;
        this.chunks = [];
        for (const j of this.queue) this.send({ op: 'error', id: j.id, kind: 'superseded', message: 'text changed' });
        this.queue = [];
        if (this.running) this.kill('superseded', 'text changed');
        else this.worker.postMessage(m);
        return;
      case 'append':
        if (m.gen !== this.gen) return;
        this.chunks.push(m.chunk);
        this.worker.postMessage(m);
        return;
      case 'splice': {
        if (m.gen !== this.gen) return;
        const s = this.chunks.join('');
        this.chunks = [s.slice(0, m.start) + m.insert + s.slice(m.end)];
        this.worker.postMessage(m);
        return;
      }
      case 'search':
      case 'expand': {
        if (m.op === 'search') {
          this.queue = this.queue.filter((j) => {
            if (j.op !== 'search') return true;
            this.send({ op: 'error', id: j.id, kind: 'superseded', message: 'superseded' });
            return false;
          });
          const r = this.running;
          if (r && r.job.op === 'search' && this.now() - r.started > KILL_AFTER_MS) this.kill('superseded', 'superseded');
        }
        if (this.running) this.queue.push(m);
        else this.run(m);
        return;
      }
    }
  }
}

export function startMatcherHost(spawn: () => Worker): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === MATCHER_PORT) new Session(port, spawn);
  });
}
