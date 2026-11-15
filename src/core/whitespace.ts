// collapse() and collapseWithMap() must agree; the map is only built lazily for matched segments.
const WS_RUN = /[ \t\n\r\f]+/g;

export function collapse(raw: string, keepNl: boolean, prevWs: boolean): string {
  if (keepNl) return collapseWithMap(raw, true, prevWs).text;
  const s = raw.replace(WS_RUN, ' ');
  return prevWs && s.charCodeAt(0) === 32 ? s.slice(1) : s;
}

export function collapseWithMap(raw: string, keepNl: boolean, prevWs: boolean): { text: string; map: Int32Array } {
  const map = new Int32Array(raw.length + 1);
  const out: string[] = [];
  let n = 0;
  let lastWs = prevWs;
  let runStart = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) { lastWs = false; continue; }
    if (i > runStart) { out.push(raw.slice(runStart, i)); for (let k = runStart; k < i; k++) map[n++] = k; }
    runStart = i + 1;
    if (keepNl && c === 10) { out.push('\n'); map[n++] = i; lastWs = true; continue; }
    if (lastWs) continue;
    out.push(' '); map[n++] = i; lastWs = true;
  }
  if (runStart < raw.length) { out.push(raw.slice(runStart)); for (let k = runStart; k < raw.length; k++) map[n++] = k; }
  map[n] = raw.length;
  return { text: out.join(''), map: map.subarray(0, n + 1) };
}

export const NEEDS_COLLAPSE = /[\t\n\r\f]| {2}/;
export const WS_ONLY = /^[ \t\n\r\f]*$/;
