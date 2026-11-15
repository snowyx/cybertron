import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:9529',
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx tests/serve.ts',
    url: 'http://127.0.0.1:9529/healthz',
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: [['list']],
});
