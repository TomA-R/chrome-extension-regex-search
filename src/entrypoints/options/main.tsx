import { render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { clearHistory, DEFAULT_SETTINGS, loadSaved, loadSettings, saveSaved, saveSettings, type SavedPattern, type Settings } from '../../shared/settings';
import { OPTION_TOGGLES } from '../../shared/presentation';
import '../../pages/page.css';
import './options.css';

function Row({ label, hint, children }: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <div class="row">
      <div class="text"><div class="label">{label}</div>{hint && <div class="hint">{hint}</div>}</div>
      <div class="control">{children}</div>
    </div>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return <input type="checkbox" role="switch" class="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />;
}

function Shortcuts() {
  const [cmds, setCmds] = useState<chrome.commands.Command[]>([]);
  useEffect(() => { void chrome.commands.getAll().then(setCmds); }, []);
  return (
    <section>
      <h2>Keyboard</h2>
      {cmds.filter((c) => c.name !== '_execute_action').sort((a) => (a.name === 'toggle-find' ? -1 : 1)).map((c) => (
        <Row key={c.name} label={c.description ?? c.name ?? ''}>
          {c.shortcut ? <kbd>{c.shortcut}</kbd> : <span class="muted">Not set</span>}
        </Row>
      ))}
      <Row label="In the find bar" hint="Enter / Shift+Enter: next / previous · ↑ / ↓: history · Alt+R / C / W / S: toggles · Esc: close">
        <button onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Change shortcuts</button>
      </Row>
    </section>
  );
}

function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<SavedPattern[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => { void loadSettings().then(setS); void loadSaved().then(setSaved); }, []);
  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(''), 1500); return () => clearTimeout(t); }, [status]);
  if (!s) return null;

  const update = async (p: Partial<Settings>) => { const n = { ...s, ...p }; setS(n); await saveSettings(n); setStatus('Saved'); };
  const num = (k: 'maxMatches' | 'timeoutMs' | 'debounceMs', label: string, hint: string, min: number, max: number, step: number) => (
    <Row label={label} hint={hint}>
      <input type="number" min={min} max={max} step={step} value={s[k]} aria-label={label}
        onChange={(e) => { const v = Number(e.currentTarget.value); if (v >= min && v <= max) void update({ [k]: v }); }} />
    </Row>
  );

  return (
    <main>
      <header>
        <h1>Regex Find</h1>
        <span class="status" role="status">{status}</span>
      </header>

      <Shortcuts />

      <section>
        <h2>Search defaults</h2>
        {OPTION_TOGGLES.map((t) => (
          <Row key={t.key} label={t.title}>
            <Switch label={t.title} checked={s.defaults[t.key]} onChange={(v) => void update({ defaults: { ...s.defaults, [t.key]: v } })} />
          </Row>
        ))}
        <Row label="Search inside text fields" hint="Inputs and text areas. Password fields are never searched.">
          <Switch label="Search inside text fields" checked={s.searchFields} onChange={(v) => void update({ searchFields: v })} />
        </Row>
        <Row label="Pre-fill the last search" hint="When opening the bar with no text selected.">
          <Switch label="Pre-fill the last search" checked={s.rememberLastQuery} onChange={(v) => void update({ rememberLastQuery: v })} />
        </Row>
      </section>

      <section>
        <h2>Appearance</h2>
        <Row label="Match colour"><input type="color" aria-label="Match colour" value={s.matchColor} onChange={(e) => void update({ matchColor: e.currentTarget.value })} /></Row>
        <Row label="Current match colour"><input type="color" aria-label="Current match colour" value={s.currentColor} onChange={(e) => void update({ currentColor: e.currentTarget.value })} /></Row>
        <p class="preview" aria-hidden="true">
          The <mark style={{ background: s.matchColor }}>quick</mark> brown fox jumps over the <mark style={{ background: s.currentColor }}>quick</mark> dog.
        </p>
      </section>

      <section>
        <h2>Limits</h2>
        {num('timeoutMs', 'Time limit per search (ms)', 'Slower patterns are stopped instead of freezing the page.', 100, 10_000, 100)}
        {num('maxMatches', 'Highlighted matches per frame', 'More are counted but not highlighted.', 1000, 1_000_000, 1000)}
        {num('debounceMs', 'Typing delay (ms)', 'How long to wait after a keystroke before searching.', 0, 1000, 10)}
      </section>

      <section>
        <h2>Saved patterns</h2>
        {!saved.length && <p class="muted pad">None yet. Use “Save pattern” in the find bar’s menu.</p>}
        {saved.map((p, i) => (
          <div class="row saved" key={p.query.pattern}>
            <input class="name" value={p.name} aria-label="Name" onChange={(e) => { const n = [...saved]; n[i] = { ...p, name: e.currentTarget.value }; setSaved(n); void saveSaved(n); }} />
            <code title={p.query.pattern}>{p.query.pattern}</code>
            <button aria-label={`Delete ${p.name}`} onClick={() => { const n = saved.filter((_, k) => k !== i); setSaved(n); void saveSaved(n); }}>Delete</button>
          </div>
        ))}
      </section>

      <section>
        <h2>Data</h2>
        <Row label="Search history" hint="Stored on this device only. Page text never leaves the browser.">
          <button onClick={() => void clearHistory().then(() => setStatus('History cleared'))}>Clear</button>
        </Row>
        <Row label="Reset all settings">
          <button onClick={() => void update({ ...DEFAULT_SETTINGS })}>Reset</button>
        </Row>
      </section>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
