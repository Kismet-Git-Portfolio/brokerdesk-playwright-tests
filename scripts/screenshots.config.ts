import base from '../playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testDir: '.', testMatch: 'screenshots.spec.ts', reporter: 'list', outputDir: '../media-results',
  use: { ...base.use, viewport: { width: 1440, height: 900 } },
  webServer: { ...(base.webServer as any), command: 'node ../app/server.js' } });
