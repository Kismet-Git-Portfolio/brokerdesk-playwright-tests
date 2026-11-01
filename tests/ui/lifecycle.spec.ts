import { test, expect } from '../../fixtures/test';

const book = async (api: any, sym = 'EURUSD', quantity = 1000000) => {
  const { mid } = await (await api.get(`/api/prices/${sym}`)).json();
  return (await api.post('/api/orders', { data: { instrument: sym, side: 'buy', price: mid, quantity, client: 'Alpha Capital', counterparty: 'NORTHBANK' } })).json();
};

test.describe('Trade lifecycle', () => {
  test('NEW → CONFIRMED → SETTLED with audit trail; illegal actions disabled', async ({ loggedIn, api, tradeDetail }) => {
    void loggedIn;
    const t = await book(api);
    await tradeDetail.goto(t.id);
    await expect(tradeDetail.status()).toHaveText('NEW');
    await expect(tradeDetail.action('settle')).toBeDisabled(); // cannot settle before confirmation
    await tradeDetail.action('confirm').click();
    await expect(tradeDetail.status()).toHaveText('CONFIRMED');
    await tradeDetail.action('settle').click();
    await expect(tradeDetail.status()).toHaveText('SETTLED');
    await expect(tradeDetail.auditActions()).toHaveText(['BOOKED', 'CONFIRMED', 'SETTLED']);
    for (const a of ['confirm', 'settle', 'fail', 'cancel'] as const) await expect(tradeDetail.action(a)).toBeDisabled();
  });

  test('settlement fail then re-settle; FAILED shows in the blotter status filter', async ({ loggedIn, api, tradeDetail, blotter }) => {
    void loggedIn;
    const t = await book(api, 'UST10Y', 50);
    await tradeDetail.goto(t.id);
    await tradeDetail.action('confirm').click();
    await tradeDetail.action('fail').click();
    await expect(tradeDetail.status()).toHaveText('FAILED');
    await blotter.goto();
    await blotter.status('FAILED');
    await expect(blotter.rows()).toHaveCount(1);
    await tradeDetail.goto(t.id);
    await tradeDetail.action('settle').click();
    await expect(tradeDetail.status()).toHaveText('SETTLED');
    await expect(tradeDetail.auditActions()).toHaveText(['BOOKED', 'CONFIRMED', 'SETTLEMENT_FAILED', 'SETTLED']);
  });

  test('amend a NEW trade: new qty/price saved, ClOrdID changes, FIX 35=G sent', async ({ loggedIn, api, tradeDetail }) => {
    void loggedIn;
    const t = await book(api, 'GBPUSD', 500000);
    await tradeDetail.goto(t.id);
    await tradeDetail.amend('750000', String(t.price));
    await expect(tradeDetail.auditActions()).toHaveText(['BOOKED', 'AMENDED']);
    const after = await (await api.get(`/api/trades/${t.id}`)).json();
    expect(after.quantity).toBe(750000);
    expect(after.notional).toBe(Math.round(after.price * 750000 * 100) / 100);
    expect(after.cl_ord_id).not.toBe(t.cl_ord_id);
    await expect(tradeDetail.fixMessages()).toHaveCount(4); // D, 8(New), G, 8(Replaced)
  });

  test('cancel removes the trade from the active blotter but keeps it in the DB', async ({ loggedIn, api, tradeDetail, blotter }) => {
    void loggedIn;
    const t = await book(api, 'BRENT', 1000);
    await tradeDetail.goto(t.id);
    await tradeDetail.action('cancel').click();
    await expect(tradeDetail.status()).toHaveText('CANCELLED');
    await blotter.goto();
    await expect(blotter.summary()).toHaveText(/^0 trade\(s\)/);
    await blotter.status('ALL');
    await expect(blotter.rows()).toHaveCount(1);
    await expect(blotter.rows().getByTestId('trade-row-status')).toHaveText('CANCELLED');
  });
});
