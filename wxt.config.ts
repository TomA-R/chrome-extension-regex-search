import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  imports: false, // explicit imports only: keeps modules portable and greppable
  vite: (env) => ({ plugins: [preact()], build: { minify: env.mode !== 'development', sourcemap: !!process.env.COVERAGE } }),
  manifest: {
    name: 'Regex Find',
    description: 'Fast, safe regular-expression find-in-page: highlights, iframes, shadow DOM, inputs, replace.',
    permissions: ['offscreen', 'storage', 'sidePanel', 'scripting', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Regex Find (Alt+Shift+F)' },
    commands: {
      'toggle-find': { suggested_key: { default: 'Alt+Shift+F', mac: 'Alt+Shift+F' }, description: 'Open / focus the regex find bar' },
      'open-panel': { suggested_key: { default: 'Alt+Shift+R', mac: 'Alt+Shift+R' }, description: 'Open the results side panel' },
    },
    minimum_chrome_version: '125',
  },
});
