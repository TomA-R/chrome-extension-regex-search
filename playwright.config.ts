import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { viewport: { width: 1200, height: 800 } },
  projects: [
    // Real modules in a plain page (no extension): fast, precise DOM/layout tests.
    { name: 'component', testDir: 'tests/component', use: { channel: 'chromium' } },
    // The built extension loaded in Chromium, driven through its message API.
    { name: 'e2e', testDir: 'tests/e2e' },
  ],
  globalSetup: './tests/component/global-setup.ts',
});
