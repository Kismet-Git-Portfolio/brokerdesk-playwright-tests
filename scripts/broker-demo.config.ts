import base from '../playwright.config';
import { defineConfig } from '@playwright/test';
// Slow-mo walkthrough video + screenshots: npx playwright test -c scripts/broker-demo.config.ts
export default defineConfig({ ...base, testDir: '.', testMatch: 'broker-demo.spec.ts', reporter: 'list', outputDir: '../media-results/broker', retries: 0, timeout: 180_000,
  use: { ...base.use, viewport: { width: 1440, height: 900 }, video: { mode: 'on', size: { width: 1440, height: 900 } }, launchOptions: { slowMo: 250 } },
  webServer: { ...(base.webServer as any), command: 'node ../app/server.js' } });
