export const BAR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.bar {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --field: #f6f8fa; --accent: #0969da;
  --on: #ddf4ff; --on-fg: #0550ae; --err: #cf222e; --err-bg: #ffebe9; --shadow: 0 8px 24px rgba(140,149,159,.3);
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg);
  border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); padding: 6px; width: 540px; max-width: calc(100vw - 32px);
  display: grid; gap: 4px; user-select: none; position: relative; overflow: visible;
  animation: enter .14s ease-out;
}
@keyframes enter { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .bar { animation: none; } .bar.busy::after { animation: show 0s .25s forwards; } }
.bar.busy::after {
  content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent); background-size: 40% 100%;
  background-repeat: no-repeat; opacity: 0; animation: show 0s .25s forwards, busy 1s linear .25s infinite;
}
@keyframes show { to { opacity: 1; } }
@keyframes busy { from { background-position: -40% 0; } to { background-position: 140% 0; } }
@media (prefers-color-scheme: dark) {
  .bar { --bg: #1c2128; --fg: #e6edf3; --muted: #9198a1; --border: #3d444d; --field: #0d1117; --accent: #4493f8;
    --on: #1f3a5f; --on-fg: #a5d6ff; --err: #ff7b72; --err-bg: #3c1618; --shadow: 0 8px 24px rgba(1,4,9,.6); }
}
.row { display: flex; align-items: center; gap: 4px; }
.field { flex: 1 1 0; min-width: 0; display: flex; align-items: center; background: var(--field); border: 1px solid var(--border); border-radius: 6px; padding: 0 2px 0 8px; height: 30px; }
.field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.field.invalid { border-color: var(--err); box-shadow: 0 0 0 1px var(--err); }
input { all: unset; flex: 1 1 0; min-width: 0; width: 0; font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--fg); height: 28px; user-select: text; }
input::placeholder { color: var(--muted); font-family: system-ui, sans-serif; }
button { all: unset; cursor: pointer; display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 4px; flex: none; border-radius: 5px; color: var(--muted); font: 600 12px ui-monospace, Menlo, monospace; }
button:hover { background: var(--field); color: var(--fg); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; }
button[aria-pressed="true"] { background: var(--accent); color: #fff; }
button[aria-pressed="true"]:hover { background: var(--accent); color: #fff; filter: brightness(1.08); }
.toggle { min-width: 26px; font-size: 12px; }
.toggle.word { text-decoration: underline; text-underline-offset: 2px; }
.nav { display: flex; align-items: center; gap: 2px; padding-left: 6px; margin-left: 2px; border-left: 1px solid var(--border); }
button:disabled { opacity: .4; cursor: default; }
.text-btn { font: 500 12px system-ui, sans-serif; padding: 0 8px; border: 1px solid var(--border); height: 26px; color: var(--fg); }
.count { font: 12px system-ui, sans-serif; color: var(--muted); min-width: 72px; flex: none; text-align: right; padding-right: 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.count.none { color: var(--err); }
.msg { font: 12px system-ui, sans-serif; padding: 4px 8px; border-radius: 6px; background: var(--err-bg); color: var(--err); white-space: pre-wrap; word-break: break-word; user-select: text; }
.msg.info { background: var(--field); color: var(--muted); }
.icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.menu { position: absolute; right: 6px; top: 40px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 4px; min-width: 240px; max-height: 360px; overflow: auto; display: grid; z-index: 1; }
.menu button { justify-content: start; display: flex; font: 13px system-ui, sans-serif; color: var(--fg); padding: 6px 8px; height: auto; gap: 8px; }
.menu .sep { height: 1px; background: var(--border); margin: 4px 2px; }
.menu .label { font: 600 11px system-ui, sans-serif; color: var(--muted); padding: 6px 8px 2px; text-transform: uppercase; letter-spacing: .04em; }
.menu code { font: 12px ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast { font: 12px system-ui, sans-serif; color: var(--fg); padding: 4px 8px; border-radius: 6px; background: var(--field); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
