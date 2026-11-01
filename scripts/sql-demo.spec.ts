// Slow-mo walkthrough of the Data Checks page + screenshots: npx playwright test -c scripts/sql-demo.config.ts
import { test } from '@playwright/test';
const OUT = process.env.MEDIA_DIR || 'media-results';
test('sql demo', async ({ page, request }) => {
  await request.post('/api/reset?seed=demo');
  await page.goto('/login');
  await page.getByTestId('login-email').fill(process.env.DEMO_USER || 'demo.user@example.com');
  await page.getByTestId('login-password').fill(process.env.DEMO_PASSWORD || 'Demo#Pass123');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/jobs$/);
  await page.goto('/trades');
  await page.getByTestId('trade-row').first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/sql-0-blotter.png`, fullPage: true });
  await page.goto('/data-checks');
  await page.waitForTimeout(800);
  for (const [k, n] of [['missing', 1], ['dupes', 2], ['joins', 3], ['recon', 4]] as const) {
    await page.getByTestId(`preset-${k}`).click();
    await page.getByTestId('sql-meta').filter({ hasText: 'row(s)' }).waitFor();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/sql-${n}-${k}.png`, fullPage: true });
  }
  await page.getByTestId('sql-editor').fill('');
  await page.getByTestId('sql-editor').pressSequentially('DELETE FROM trades;', { delay: 60 });
  await page.getByTestId('sql-run').click();
  await page.getByTestId('sql-error').filter({ hasText: 'Only SELECT' }).waitFor();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/sql-5-blocked.png`, fullPage: true });
});
