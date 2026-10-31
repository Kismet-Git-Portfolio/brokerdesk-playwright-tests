import { test, expect } from '../../fixtures/test';

test.describe('Trade booking', () => {
  for (const [label, price, quantity, msg] of [
    ['negative price', '-1', '10', 'Price must be a positive number'],
    ['zero price', '0', '10', 'Price must be a positive number'],
    ['non-numeric price', 'abc', '10', 'Price must be a positive number'],
    ['negative quantity', '10', '-5', 'Quantity must be a positive number'],
    ['zero quantity', '10', '0', 'Quantity must be a positive number'],
    ['non-numeric quantity', '10', 'ten', 'Quantity must be a positive number'],
  ]) {
    test(`rejects ${label}`, async ({ loggedIn, tradesPage, api }) => {
      void loggedIn;
      await tradesPage.goto();
      await tradesPage.fill({ instrument: 'EURUSD', side: 'buy', price, quantity });
      await tradesPage.submit().click();
      await expect(tradesPage.error()).toHaveText(msg);
      expect(await (await api.get('/api/trades')).json()).toHaveLength(0);
    });
  }

  test('rapid double click books exactly one trade', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'GBPUSD', side: 'sell', price: '1.2734', quantity: '1000' });
    await tradesPage.submit().dblclick();
    await expect(tradesPage.rows()).toHaveCount(1);
    expect(await (await api.get('/api/trades')).json()).toHaveLength(1);
  });

  test('blotter row equals API values (notional to 2 decimals)', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'ust10y', side: 'buy', price: '99.875', quantity: '3' });
    await tradesPage.submit().click();
    await expect(tradesPage.rows()).toHaveCount(1);
    const [t] = await (await api.get('/api/trades')).json();
    expect(t.notional).toBe(299.63); // 299.625 rounded half-up
    const row = tradesPage.row(t.id);
    await expect(row.getByTestId('trade-row-instrument')).toHaveText('UST10Y');
    await expect(row.getByTestId('trade-row-side')).toHaveText(t.side);
    await expect(row.getByTestId('trade-row-price')).toHaveText(String(t.price));
    await expect(row.getByTestId('trade-row-qty')).toHaveText(String(t.quantity));
    await expect(row.getByTestId('trade-row-notional')).toHaveText(t.notional.toFixed(2));
  });

  test('filter shows only buys or only sells', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    for (const [side, i] of [['buy', 1], ['sell', 2], ['buy', 3]] as const)
      await api.post('/api/trades', { data: { instrument: `INST${i}`, side, price: 10, quantity: i } });
    await tradesPage.goto();
    await expect(tradesPage.rows()).toHaveCount(3);
    await tradesPage.filter('sell');
    await expect(tradesPage.rows()).toHaveCount(1);
    await expect(tradesPage.rows().getByTestId('trade-row-side')).toHaveText(['sell']);
    await tradesPage.filter('buy');
    await expect(tradesPage.rows().getByTestId('trade-row-side')).toHaveText(['buy', 'buy']);
  });
});
