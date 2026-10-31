import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3100);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  // The mock app keeps data in memory, so run one worker to keep it predictable.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    testIdAttribute: 'data-testid',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts the mock app before the tests and stops it afterwards.
  webServer: {
    command: 'node app/server.js',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 30_000,
  },
});
