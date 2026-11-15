export function expandReplacement(template: string, m: RegExpExecArray, input: string): string {
  if (!template.includes('$')) return template;
  const groups = m.groups;
  const ncap = m.length - 1;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c !== '$' || i === template.length - 1) { out += c; continue; }
    const n = template[i + 1]!;
    if (n === '$') { out += '$'; i++; continue; }
    if (n === '&') { out += m[0]; i++; continue; }
    if (n === '`') { out += input.slice(0, m.index); i++; continue; }
    if (n === "'") { out += input.slice(m.index + m[0].length); i++; continue; }
    if (n === '<' && groups) {
      const close = template.indexOf('>', i + 2);
      if (close > 0) { out += groups[template.slice(i + 2, close)] ?? ''; i = close; continue; }
    }
    if (n >= '0' && n <= '9') {
      const two = template[i + 2];
      const twoDigit = two !== undefined && two >= '0' && two <= '9' ? Number(n + two) : -1;
      if (twoDigit >= 1 && twoDigit <= ncap) { out += m[twoDigit] ?? ''; i += 2; continue; }
      const one = Number(n);
      if (one >= 1 && one <= ncap) { out += m[one] ?? ''; i++; continue; }
    }
    out += c;
  }
  return out;
}

export function replacementAt(text: string, source: string, flags: string, start: number, template: string): string | null {
  // Sticky, so a miss doesn't scan the rest of the document.
  const re = new RegExp(source, flags.replace('g', '') + 'y');
  re.lastIndex = start;
  const m = re.exec(text);
  if (!m) return null;
  return expandReplacement(template, m, text);
}
