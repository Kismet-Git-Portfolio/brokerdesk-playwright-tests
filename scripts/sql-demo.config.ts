import base from '../playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testDir: '.', testMatch: 'sql-demo.spec.ts', reporter: 'list', outputDir: '../media-results/sql', retries: 0,
  use: { ...base.use, viewport: { width: 1440, height: 900 }, video: { mode: 'on', size: { width: 1440, height: 900 } }, launchOptions: { slowMo: 250 } },
  webServer: { ...(base.webServer as any), command: 'node ../app/server.js' } });
