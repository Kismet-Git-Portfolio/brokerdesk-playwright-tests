// Records slowed-down videos of the key UI tests for demo purposes: npx playwright test -c playwright.media.config.ts
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  outputDir: 'media-results',
  reporter: 'list',
  retries: 0,
  grep: /valid login|gross total|batch|slow network|payout amount|double click|blotter row|filter shows/,
  use: { ...base.use, video: { mode: 'on', size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 }, launchOptions: { slowMo: 400 } },
});
