// Merges unit (Vitest) and browser (V8, via sourcemaps) coverage into one report for src/.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import v8toIstanbul from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const root = process.cwd();
const map = libCoverage.createCoverageMap({});
const inSrc = (f) => f.startsWith(path.join(root, 'src') + path.sep);

const unit = path.join(root, 'coverage/unit/coverage-final.json');
if (existsSync(unit)) map.merge(JSON.parse(readFileSync(unit, 'utf8')));

const localFile = (url) => {
  if (url.startsWith('chrome-extension://')) return path.join(root, 'dist/chrome-mv3', new URL(url).pathname);
  if (url.endsWith('/rx.js')) return path.join(root, 'dist/component/rx.js');
  return null;
};

const rawDir = path.join(root, 'coverage/raw');
const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
for (const f of files) {
  for (const entry of JSON.parse(readFileSync(path.join(rawDir, f), 'utf8'))) {
    const file = localFile(entry.url);
    if (!file || !existsSync(file + '.map')) continue;
    const sourceMap = JSON.parse(readFileSync(file + '.map', 'utf8'));
    const conv = v8toIstanbul(file, 0, { source: entry.source ?? readFileSync(file, 'utf8'), sourceMap: { sourcemap: sourceMap } });
    await conv.load();
    conv.applyCoverage(entry.functions);
    const data = conv.toIstanbul();
    for (const [k, v] of Object.entries(data)) {
      const abs = path.resolve(path.dirname(file), k);
      const key = existsSync(k) ? path.resolve(k) : abs;
      if (inSrc(key)) map.merge({ [key]: { ...v, path: key } });
    }
  }
}
map.filter((f) => inSrc(f));

const context = libReport.createContext({ dir: path.join(root, 'coverage/report'), coverageMap: map, defaultSummarizer: 'nested' });
for (const r of ['text', 'text-summary', 'html']) reports.create(r, { skipFull: r === 'text' }).execute(context);
if (process.argv.includes('--clean')) rmSync(rawDir, { recursive: true, force: true });
