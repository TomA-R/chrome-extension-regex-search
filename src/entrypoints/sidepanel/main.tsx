import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Query } from '../../core/query';
import type { CoordState } from '../../shared/messages';
import { countLabel, OPTION_TOGGLES, replaceSummary } from '../../shared/presentation';
import { useCoordinator, useHeight, useSnippetPages, useToast, type Send } from './hooks';
import '../../pages/page.css';
import './panel.css';

const ROW = 56;

function App() {
  const c = useCoordinator();
  if (c.kind === 'unavailable') {
    return (
      <div class="empty">
        <b>This page can’t be searched</b>
        <span>Browser pages, the Chrome Web Store and the PDF viewer don’t allow extensions.</span>
      </div>
    );
  }
  if (c.kind === 'connecting') return <div class="empty"><span>Connecting…</span></div>;
  return <Panel state={c.state} send={c.send} />;
}

function Panel({ state, send }: { state: CoordState; send: Send }) {
  const [toast, setToast] = useToast();
  return (
    <div class="panel">
      <header>
        <SearchControls state={state} send={send} />
        <ReplaceAndExport state={state} send={send} onDone={setToast} />
        {toast && <div class="toast" role="status">{toast}</div>}
      </header>
      <ResultList state={state} send={send} />
    </div>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const UP = 'M6 15l6-6 6 6', DOWN = 'M6 9l6 6 6-6', CHEV = 'M9 6l6 6-6 6';

function SearchControls({ state, send }: { state: CoordState; send: Send }) {
  const q = state.query;
  const setQuery = (next: Query) => void send({ t: 'coord.setQuery', query: next });
  const c = countLabel(state);
  return (
    <>
      <div class={`field${state.status === 'error' ? ' invalid' : ''}`}>
        <input placeholder={q.regex ? 'Find (regex)' : 'Find (text)'} value={q.pattern} spellcheck={false} aria-label="Find"
          onInput={(e) => setQuery({ ...q, pattern: e.currentTarget.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') void send({ t: e.shiftKey ? 'coord.prev' : 'coord.next' }); }} />
        {OPTION_TOGGLES.map((t) => (
          <button key={t.key} class={`toggle${t.key === 'wholeWord' ? ' word' : ''}`} title={t.title} aria-label={t.title} aria-pressed={q[t.key]}
            onClick={() => setQuery({ ...q, [t.key]: !q[t.key] })}>{t.label}</button>
        ))}
      </div>
      <div class="status">
        <span class={`count${c.bad ? ' bad' : ''}`} aria-live="polite">{c.text || '\u00a0'}</span>
        <button class="icon-btn" title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!state.total} onClick={() => void send({ t: 'coord.prev' })}><Icon d={UP} /></button>
        <button class="icon-btn" title="Next (Enter)" aria-label="Next match" disabled={!state.total} onClick={() => void send({ t: 'coord.next' })}><Icon d={DOWN} /></button>
      </div>
      {state.error && (state.status === 'error' || state.status === 'timeout') && <div class="error">{state.error}</div>}
    </>
  );
}

function ReplaceAndExport({ state, send, onDone }: { state: CoordState; send: Send; onDone: (msg: string) => void }) {
  const [replacement, setReplacement] = useState('');
  const copy = async (text: string, what: string) => { await navigator.clipboard.writeText(text); onDone(`Copied ${what}`); };
  const copyAll = async () => {
    const t = await send({ t: 'coord.copyAll' });
    if (t) await copy(t.join('\n'), `${t.length.toLocaleString()} matches`);
  };
  const exportJson = async () => {
    const r = await send({ t: 'coord.snippets', offset: 0, limit: state.total });
    if (r) await copy(JSON.stringify(r.items.map(({ match, before, after, frameId }) => ({ match, before, after, frameId })), null, 2), `${r.items.length.toLocaleString()} results as JSON`);
  };
  return (
    <details class="more">
      <summary><Icon d={CHEV} />Replace &amp; export</summary>
      <div class="field"><input placeholder="Replace with ($1, $<name>)" aria-label="Replacement" value={replacement} spellcheck={false} onInput={(e) => setReplacement(e.currentTarget.value)} /></div>
      <div class="actions">
        <button disabled={!state.currentEditable} title={state.currentEditable ? '' : 'The current match isn’t in an editable field'} onClick={async () => onDone(replaceSummary(await send({ t: 'coord.replace', template: replacement, all: false })))}>Replace</button>
        <button disabled={!state.total} onClick={async () => onDone(replaceSummary(await send({ t: 'coord.replace', template: replacement, all: true })))}>Replace all</button>
        <span class="spacer" />
        <button disabled={!state.total} onClick={copyAll}>Copy</button>
        <button disabled={!state.total} onClick={exportJson}>JSON</button>
      </div>
    </details>
  );
}

function ResultList({ state, send }: { state: CoordState; send: Send }) {
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const height = useHeight(list);
  const total = state.total;
  const first = Math.floor(scrollTop / ROW);
  const last = Math.min(total, first + Math.ceil(height / ROW) + 1);
  const rows = useSnippetPages(send, state, first, last);

  useEffect(() => { // keep the current match in view
    const el = list.current;
    if (!el || state.current < 0) return;
    const y = state.current * ROW;
    if (y < el.scrollTop || y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight / 2;
  }, [state.current]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    void send({ t: e.key === 'ArrowDown' ? 'coord.next' : 'coord.prev' });
  };

  const items = [];
  for (let i = first; i < last; i++) {
    const s = rows.get(i);
    items.push(
      <div key={i} class={`item${i === state.current ? ' current' : ''}`} style={{ top: `${i * ROW}px` }} role="option" aria-selected={i === state.current}
        onClick={() => { if (s) void send({ t: 'coord.goto', frameId: s.frameId, index: s.index }); }}>
        <span class="num">{i + 1}</span>
        {s
          ? <span class="ctx">{s.before}<mark>{s.match}</mark>{s.after}</span>
          : <span class="ctx loading" />}
        {s && (s.frameId !== 0 || s.editable) && (
          <span class="tags">{s.frameId !== 0 && <span class="tag">frame</span>}{s.editable && <span class="tag">editable</span>}</span>
        )}
      </div>,
    );
  }
  const busy = state.status === 'searching' || state.status === 'indexing';
  return (
    <div class="list" ref={list} tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="listbox" aria-label="Matches">
      <div style={{ height: `${total * ROW}px`, position: 'relative' }}>{items}</div>
      {!total && (
        <div class="empty">
          {state.query.pattern
            ? (busy ? 'Searching…' : <><b>No matches</b><span>Try a different pattern or turn off Match case / Whole word.</span></>)
            : <><b>Search this page</b><span>Type a regular expression above. Results appear here with their context.</span></>}
        </div>
      )}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
