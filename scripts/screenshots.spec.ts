// Full-page screenshots for the README/demo: npx playwright test -c scripts/screenshots.config.ts
import { test } from '@playwright/test';
const OUT = process.env.MEDIA_DIR || 'media-results';
test('capture screenshots', async ({ page, request }) => {
  await request.post('/api/reset');
  for (const [w, b, a, s] of [['Ana Reyes', 1500, 250.75, 99.99], ['Ben Cruz', 980, 120, 0], ['Carla Santos', 2100.5, 300, 150.25]] as const)
    await request.post('/api/payouts', { data: { worker: w, base: b, allowance: a, special: s } });
  for (const [i, side, p, q] of [['GBPUSD', 'buy', 1.2734, 250000], ['EURUSD', 'sell', 1.0842, 500000], ['UST10Y', 'buy', 99.875, 30], ['USDJPY', 'sell', 151.23, 100000], ['XAUUSD', 'buy', 2384.4, 12]] as const)
    await request.post('/api/trades', { data: { instrument: i, side, price: p, quantity: q } });
  await page.goto('/login');
  await page.getByTestId('login-email').fill(process.env.DEMO_USER || 'demo.user@example.com');
  await page.getByTestId('login-password').fill(process.env.DEMO_PASSWORD || 'Demo#Pass123');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/);
  await page.goto('/');
  await page.screenshot({ path: `${OUT}/v2-showcase-home.png`, fullPage: true });
  await page.goto('/payouts');
  await page.getByTestId('payout-row').first().waitFor();
  await page.screenshot({ path: `${OUT}/v2-payouts.png`, fullPage: true });
  await page.getByRole('link', { name: 'Statement' }).first().click();
  await page.getByTestId('statement-total').waitFor();
  await page.screenshot({ path: `${OUT}/v2-payout-statement.png`, fullPage: true });
  await page.goto('/trades');
  await page.getByTestId('trade-row').first().waitFor();
  await page.getByTestId('trade-instrument').fill('GBPUSD');
  await page.getByTestId('trade-price').fill('1.2741');
  await page.getByTestId('trade-quantity').fill('-5');
  await page.screenshot({ path: `${OUT}/v2-trading-desk.png`, fullPage: true });
  await page.goto('/jobs');
  await page.getByTestId('job-row').first().waitFor();
  await page.screenshot({ path: `${OUT}/v2-jobs-board.png`, fullPage: true });
});
