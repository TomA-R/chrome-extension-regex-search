import type { WorkerRequest, WorkerResponse } from '../shared/messages';
import { replacementAt } from '../core/replace';

export function createEngine(post: (m: WorkerResponse) => void): (m: WorkerRequest) => void {
  let gen = -1;
  let chunks: string[] = [];
  let text: string | null = '';
  const getText = () => {
    if (text === null) { text = chunks.join(''); chunks = [text]; }
    return text;
  };

  return (m) => {
    switch (m.op) {
      case 'reset':
        gen = m.gen; chunks = []; text = '';
        return;
      case 'append':
        if (m.gen !== gen) return;
        chunks.push(m.chunk); text = null;
        return;
      case 'splice': {
        if (m.gen !== gen) return;
        const s = getText();
        text = s.slice(0, m.start) + m.insert + s.slice(m.end);
        chunks = [text];
        return;
      }
      case 'search': {
        if (m.gen !== gen) { post({ op: 'error', id: m.id, kind: 'superseded', message: 'stale generation' }); return; }
        const t0 = performance.now();
        let re: RegExp;
        try { re = new RegExp(m.source, m.flags.includes('g') ? m.flags : m.flags + 'g'); } catch (err) { post({ op: 'error', id: m.id, kind: 'syntax', message: String(err) }); return; }
        const s = getText();
        const ranges: number[] = [];
        let total = 0;
        for (const x of s.matchAll(re)) {
          const len = x[0].length;
          if (!len) continue;
          if (total < m.max) ranges.push(x.index, x.index + len);
          total++;
        }
        post({ op: 'result', id: m.id, gen, ranges, total, truncated: total > m.max, ms: performance.now() - t0 });
        return;
      }
      case 'expand': {
        if (m.gen !== gen) { post({ op: 'error', id: m.id, kind: 'superseded', message: 'stale generation' }); return; }
        const s = getText();
        try {
          post({ op: 'expanded', id: m.id, values: m.starts.map((st) => replacementAt(s, m.source, m.flags, st, m.template)) });
        } catch (err) { post({ op: 'error', id: m.id, kind: 'syntax', message: String(err) }); }
        return;
      }
    }
  };
}
