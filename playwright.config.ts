import { defineConfig, devices } from '@playwright/test';

// Browser tests. Start the stack first: scripts/e2e-stack.sh (database, API, app build).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174/the-yard/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx vite preview --outDir dist-e2e --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174/the-yard/',
    reuseExistingServer: true,
  },
});
