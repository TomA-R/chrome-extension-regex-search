import { build } from 'vite';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: path.resolve('dist/component'),
      emptyOutDir: true,
      minify: false,
      sourcemap: !!process.env.COVERAGE,
      lib: { entry: path.resolve('tests/component/entry.ts'), formats: ['iife'], name: 'rxComponent', fileName: () => 'rx.js' },
    },
  });
}
