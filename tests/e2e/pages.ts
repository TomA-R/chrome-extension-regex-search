export function bigPage(paragraphs: number): string {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua foo@example.com 2026-11-15 ERROR-4211'.split(' ');
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let html = '<!doctype html><html><body><div id=root>';
  for (let i = 0; i < paragraphs; i++) {
    let p = '<p>';
    for (let j = 0; j < 40; j++) { const w = words[Math.floor(rnd() * words.length)]; p += rnd() < 0.05 ? `<b>${w}</b> ` : w + ' '; }
    html += p + '</p>';
  }
  return html + '</div></body></html>';
}
