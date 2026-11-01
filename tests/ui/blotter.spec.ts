import { test, expect } from '../../fixtures/test';

test.describe('Blotter filters (seeded desk)', () => {
  test.beforeEach(async ({ loggedIn, api }) => { void loggedIn; await api.post('/api/reset?seed=demo'); });

  test('asset class filter shows only that class and agrees with the API', async ({ blotter, api }) => {
    await blotter.goto();
    await expect(blotter.rows()).toHaveCount(10); // 11 in DB minus 1 cancelled
    for (const cls of ['FX', 'Rates', 'Credit', 'Energy', 'Commodities']) {
      const expected = await (await api.get(`/api/trades?asset_class=${cls}`)).json();
      await blotter.assetClass(cls);
      await expect(blotter.rows()).toHaveCount(expected.length);
      await expect(blotter.rows().getByTestId('trade-row-class')).toHaveText(expected.map(() => cls));
    }
  });

  test('status filter: SETTLED, FAILED and CANCELLED', async ({ blotter }) => {
    await blotter.goto();
    for (const [s, n] of [['SETTLED', 5], ['FAILED', 1], ['CANCELLED', 1], ['NEW', 2], ['ALL', 11]] as const) {
      await blotter.status(s);
      await expect(blotter.rows()).toHaveCount(n);
    }
  });

  test('overview KPIs match the seeded desk', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('kpi-trades')).toHaveText('10');
    await expect(page.getByTestId('kpi-unsettled')).toHaveText('3');
    await expect(page.getByTestId('kpi-rejects')).toHaveText('2');
    await expect(page.getByTestId('class-row')).toHaveCount(5);
  });
});
