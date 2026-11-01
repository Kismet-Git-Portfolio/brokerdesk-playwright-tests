import { test, expect } from '../../fixtures/test';

const mid = async (api: any, sym: string) => (await (await api.get(`/api/prices/${sym}`)).json()).mid as number;

test.describe('Order ticket (RFQ)', () => {
  test('valid order: confirmation shows trade ID + ClOrdID and matches the API', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    const px = await mid(api, 'USDJPY');
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'USDJPY', side: 'sell', price: String(px), quantity: '2000000', client: 'Delta Pension Fund', counterparty: 'EASTSEC', venue: 'Voice' });
    await tradesPage.submit().click();
    const id = await tradesPage.confirmedId();
    const t = await (await api.get(`/api/trades/${id}`)).json();
    expect(t).toMatchObject({ instrument: 'USDJPY', side: 'sell', quantity: 2000000, price: px, client: 'Delta Pension Fund', counterparty: 'EASTSEC', venue: 'Voice', status: 'NEW' });
    await expect(tradesPage.confirmation().getByTestId('confirm-clordid')).toHaveText(t.cl_ord_id);
    await expect(tradesPage.row(id).getByTestId('trade-row-notional')).toHaveText(t.notional.toFixed(2));
  });

  for (const [field, msg] of [['client', 'Client is required'], ['counterparty', 'Counterparty is required']] as const) {
    test(`missing ${field} is rejected`, async ({ loggedIn, tradesPage, api }) => {
      void loggedIn;
      const px = await mid(api, 'EURUSD');
      await tradesPage.goto();
      await tradesPage.fill({ instrument: 'EURUSD', side: 'buy', price: String(px), quantity: '100', [field]: '' });
      await tradesPage.submit().click();
      await expect(tradesPage.error()).toHaveText(msg);
      expect(await (await api.get('/api/trades')).json()).toHaveLength(0);
    });
  }

  test('fat-finger price outside the tolerance band is rejected and counted as a reject', async ({ loggedIn, tradesPage, api, page }) => {
    void loggedIn;
    const px = await mid(api, 'BRENT');
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'BRENT', side: 'buy', price: (px * 1.1).toFixed(2), quantity: '5000' }); // 10% off, band is ±2%
    await expect(page.locator('#h-price')).toHaveText('Outside ±2% band'); // client-side warning before submit
    await tradesPage.submit().click();
    await expect(tradesPage.error()).toHaveText(/^Price outside tolerance band: ±2% of market/);
    expect(await (await api.get('/api/trades')).json()).toHaveLength(0);
    expect((await (await api.get('/api/stats')).json()).rejects).toBe(1);
  });

  test('price just inside the band is accepted ("Ask" button fills the market price)', async ({ loggedIn, tradesPage, page }) => {
    void loggedIn;
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'BUND10Y', side: 'buy', price: '', quantity: '25' });
    await page.getByTestId('use-ask').click();
    await expect(page.getByTestId('trade-price')).not.toHaveValue('');
    await tradesPage.submit().click();
    await expect(tradesPage.confirmation()).toContainText('Order accepted');
  });

  test('double click on Submit order books exactly one trade (idempotency)', async ({ loggedIn, tradesPage, api }) => {
    void loggedIn;
    const px = await mid(api, 'XAUUSD');
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'XAUUSD', side: 'buy', price: String(px), quantity: '7' });
    await tradesPage.submit().dblclick();
    await expect(tradesPage.rows()).toHaveCount(1);
    await tradesPage.page_settle();
    expect(await (await api.get('/api/trades')).json()).toHaveLength(1);
    const fix = await (await api.get('/api/fix')).json();
    expect(fix.filter((m: any) => m.msg_type === 'D')).toHaveLength(1); // only one NewOrderSingle went out
  });
});
