import { test, expect } from '../../fixtures/test';

test.describe('Price board (market data)', () => {
  test('quotes tick: timestamp moves, bid < ask for every instrument', async ({ loggedIn, priceBoard }) => {
    void loggedIn;
    await priceBoard.goto();
    await expect(priceBoard.rows()).toHaveCount(8);
    const first = await priceBoard.quote('EURUSD');
    await expect.poll(async () => (await priceBoard.quote('EURUSD')).ts, { timeout: 5000 }).not.toBe(first.ts);
    for (const sym of ['EURUSD', 'USDJPY', 'UST10Y', 'BUND10Y', 'BRENT', 'XAUUSD']) {
      const q = await priceBoard.quote(sym);
      expect(q.bid, sym).toBeLessThan(q.ask);
      await expect(priceBoard.row(sym).getByTestId('price-status')).toHaveText('LIVE');
    }
  });

  test('feed outage turns a price STALE, it stops ticking, and restoring brings it back', async ({ loggedIn, priceBoard }) => {
    void loggedIn;
    await priceBoard.goto();
    const brent = priceBoard.row('BRENT');
    await brent.getByTestId('price-freeze').click();
    await expect(brent.getByTestId('price-status')).toHaveText('STALE');
    const frozen = await priceBoard.quote('BRENT');
    await priceBoard.page_wait(2200);
    expect((await priceBoard.quote('BRENT')).ts).toBe(frozen.ts); // no new ticks while stale
    await expect(priceBoard.row('EURUSD').getByTestId('price-status')).toHaveText('LIVE'); // other feeds unaffected
    await brent.getByTestId('price-resume').click();
    await expect(brent.getByTestId('price-status')).toHaveText('LIVE');
  });

  test('order on a stale instrument is blocked on the ticket', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    const q = await (await api.post('/api/prices/XAUUSD/freeze')).json();
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'XAUUSD', side: 'buy', price: String(q.mid), quantity: '10' });
    await expect(tradesPage.market().getByTestId('ticket-stale')).toBeVisible();
    await tradesPage.submit().click();
    await expect(tradesPage.error()).toHaveText('Market data for XAUUSD is stale. Cannot validate price');
    expect(await (await api.get('/api/trades')).json()).toHaveLength(0);
  });
});
