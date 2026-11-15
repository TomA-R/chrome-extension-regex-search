import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Query, SearchOptions } from '../../../core/query';
import type { CoordState } from '../../../shared/messages';
import { countLabel, OPTION_TOGGLES, replaceSummary, truncationNote } from '../../../shared/presentation';
import { Menu } from './Menu';
import { clearHistory, loadHistory, loadSaved, saveSaved, type SavedPattern } from '../../../shared/settings';

export interface BarActions {
  setQuery(q: Query, immediate?: boolean): void;
  next(): void;
  prev(): void;
  close(): void;
  copyAll(): Promise<number>;
  replace(template: string, all: boolean): Promise<{ replaced: number; skipped: number }>;
  openPanel(): Promise<boolean>;
  openOptions(): void;
}

export interface BarProps {
  subscribe: (fn: (s: CoordState) => void) => () => void;
  actions: BarActions;
  focusSignal: { subscribe: (fn: () => void) => () => void };
}

const Icon = ({ d, bold }: { d: string; bold?: boolean }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" style={bold ? 'stroke-width:3.2' : undefined}><path d={d} /></svg>
);
const UP = 'M6 15l6-6 6 6', DOWN = 'M6 9l6 6 6-6', CLOSE = 'M6 6l12 12M18 6L6 18', MORE = 'M5 12h.01M12 12h.01M19 12h.01';
const CHEV_R = 'M9 6l6 6-6 6', CHEV_D = 'M6 9l6 6 6-6';

const fmt = (n: number) => n.toLocaleString();

export function FindBar({ subscribe, actions, focusSignal }: BarProps) {
  const [s, setS] = useState<CoordState | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState<Query[]>([]);
  const [saved, setSaved] = useState<SavedPattern[]>([]);
  const [toast, setToast] = useState('');
  const histPos = useRef(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => subscribe(setS), [subscribe]);
  useEffect(() => focusSignal.subscribe(() => { input.current?.focus(); input.current?.select(); }), [focusSignal]);
  // Focus synchronously on mount so the first keystrokes after the shortcut aren't lost.
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, [s === null]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t); }, [toast]);

  if (!s) return null;
  const q = s.query;
  const set = (p: Partial<Query>, immediate = false) => { histPos.current = -1; actions.setQuery({ ...q, ...p }, immediate); };
  const toggle = (k: keyof SearchOptions) => set({ [k]: !q[k] }, true);
  const c = countLabel(s);

  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod && e.altKey) { e.preventDefault(); void doReplace(true); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) actions.prev(); else actions.next(); return; }
    if (e.altKey && !mod) {
      const t = OPTION_TOGGLES.find((x) => x.code === e.code);
      if (t) { e.preventDefault(); toggle(t.key); return; }
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey) {
      e.preventDefault();
      void loadHistory().then((h) => {
        if (!h.length) return;
        const pos = Math.min(h.length - 1, Math.max(-1, histPos.current + (e.key === 'ArrowUp' ? 1 : -1)));
        histPos.current = pos;
        if (pos >= 0) actions.setQuery(h[pos]!, true);
      });
    }
  };

  const doReplace = async (all: boolean) => {
    setToast(replaceSummary(await actions.replace(replacement, all)));
  };

  const openMenu = async () => {
    if (menu) { setMenu(false); return; }
    setHistory(await loadHistory());
    setSaved(await loadSaved());
    setMenu(true);
  };
  const pick = (query: Query) => { setMenu(false); actions.setQuery(query, true); input.current?.focus(); };
  const saveCurrent = async () => {
    setMenu(false);
    if (!q.pattern) return;
    const list = await loadSaved();
    if (!list.some((x) => x.query.pattern === q.pattern)) await saveSaved([{ name: q.pattern, query: q }, ...list]);
    setToast('Pattern saved');
  };

  const showMsg = (s.status === 'error' || s.status === 'timeout') && s.error;
  return (
    <div class={`bar${s.status === 'searching' || s.status === 'indexing' ? ' busy' : ''}`} role="search" aria-label="Regex find"
      onKeyDown={(e) => {
        // Esc from anywhere in the bar: close the menu first, then the bar.
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (menu) setMenu(false); else actions.close();
      }}>
      <div class="row">
        <button title={replaceOpen ? 'Hide replace' : 'Show replace'} aria-label="Toggle replace" aria-expanded={replaceOpen} onClick={() => setReplaceOpen(!replaceOpen)}><Icon d={replaceOpen ? CHEV_D : CHEV_R} /></button>
        <div class={`field${s.status === 'error' ? ' invalid' : ''}`}>
          <input ref={input} placeholder={q.regex ? 'Find (regex)' : 'Find (text)'} value={q.pattern} spellcheck={false} autocomplete="off"
            aria-label="Find" aria-invalid={s.status === 'error'}
            onInput={(e) => set({ pattern: (e.currentTarget).value })} onKeyDown={onKey} />
          {OPTION_TOGGLES.map((t) => (
            <button key={t.key} class={`toggle${t.key === 'wholeWord' ? ' word' : ''}`} title={`${t.title} (Alt+${t.code.slice(3)})`} aria-label={t.title} aria-pressed={q[t.key]}
              disabled={t.key === 'dotAll' && !q.regex} onClick={() => toggle(t.key)}>{t.label}</button>
          ))}
        </div>
        <span class={`count${c.bad ? ' none' : ''}`} aria-live="polite">{c.text}</span>
        <div class="nav">
        <button title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!s.total} onClick={() => actions.prev()}><Icon d={UP} /></button>
        <button title="Next match (Enter)" aria-label="Next match" disabled={!s.total} onClick={() => actions.next()}><Icon d={DOWN} /></button>
        <button title="More" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={openMenu}><Icon d={MORE} bold /></button>
        <button title="Close (Esc)" aria-label="Close" onClick={() => actions.close()}><Icon d={CLOSE} /></button>
        </div>
      </div>
      {replaceOpen && (
        <div class="row">
          <span style="width:24px" />
          <div class="field">
            <input placeholder="Replace ($1, $<name>, $&)" value={replacement} spellcheck={false} aria-label="Replace"
              onInput={(e) => setReplacement((e.currentTarget).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void doReplace((e.metaKey || e.ctrlKey) && e.altKey); }
              }} />
          </div>
          <button class="text-btn" disabled={!s.currentEditable} title={s.currentEditable ? 'Replace current (Enter)' : 'Current match isn’t in an editable field'} onClick={() => void doReplace(false)}>Replace</button>
          <button class="text-btn" disabled={!s.total} title="Replace all editable matches (Ctrl/Cmd+Alt+Enter)" onClick={() => void doReplace(true)}>All</button>
        </div>
      )}
      {showMsg && <div class="msg" role="alert">{s.status === 'timeout' ? `This pattern is too slow (likely catastrophic backtracking) and was stopped.\n${s.error}` : s.error}</div>}
      {truncationNote(s) && <div class="msg info">{truncationNote(s)}</div>}
      {toast && <div class="toast" role="status">{toast}</div>}
      {menu && (
        <Menu onClose={() => setMenu(false)} returnFocus={() => input.current?.focus()}>
          <button role="menuitem" disabled={!s.total} onClick={async () => { setMenu(false); const n = await actions.copyAll(); setToast(`Copied ${fmt(n)} matches`); }}>Copy all matches</button>
          <button role="menuitem" onClick={async () => { setMenu(false); if (!(await actions.openPanel())) setToast('Press Alt+Shift+R to open the results panel'); }}>Show results panel</button>
          <button role="menuitem" disabled={!q.pattern} onClick={saveCurrent}>Save pattern</button>
          <button role="menuitem" onClick={() => { setMenu(false); actions.openOptions(); }}>Settings…</button>
          {saved.length > 0 && <><div class="sep" /><div class="label">Saved</div>
            {saved.slice(0, 15).map((x) => <button role="menuitem" title={x.query.pattern} onClick={() => pick(x.query)}><code>{x.name}</code></button>)}</>}
          {history.length > 0 && <><div class="sep" /><div class="label">Recent</div>
            {history.slice(0, 15).map((x) => <button role="menuitem" title={x.pattern} onClick={() => pick(x)}><code>{x.pattern}</code></button>)}
            <button role="menuitem" onClick={async () => { await clearHistory(); setHistory([]); }}>Clear history</button></>}
        </Menu>
      )}
    </div>
  );
}
