import { test, expect } from '../../fixtures/test';

test.describe('FIX message log', () => {
  test('order from the ticket emits 35=D whose tags 11/55/54/38/44 match the UI order', async ({ loggedIn, tradesPage, fixLog, api, page }) => {
    void loggedIn;
    const { mid } = await (await api.get('/api/prices/UST10Y')).json();
    await tradesPage.goto();
    await tradesPage.fill({ instrument: 'UST10Y', side: 'sell', price: String(mid), quantity: '40', counterparty: 'WESTCAP' });
    await tradesPage.submit().click();
    const id = await tradesPage.confirmedId();
    const clOrdId = (await page.getByTestId('confirm-clordid').textContent())!.trim();
    await page.getByTestId('confirm-fix').click();
    await expect(fixLog.rows()).toHaveCount(2);
    await fixLog.rowsOfType('D').click();
    expect(await fixLog.value(35)).toBe('D');
    expect(await fixLog.value(11)).toBe(clOrdId);
    expect(await fixLog.value(55)).toBe('UST10Y');
    expect(await fixLog.value(54)).toBe('2'); // 2 = Sell
    expect(await fixLog.value(38)).toBe('40');
    expect(await fixLog.value(44)).toBe(String(mid));
    expect(await fixLog.value(56)).toBe('WESTCAP');
    await fixLog.rowsOfType('8').click();
    expect(await fixLog.value(37)).toBe(id);
    expect(await fixLog.value(150)).toBe('0'); // ExecType New
    expect(await fixLog.value(39)).toBe('0'); // OrdStatus New
  });

  test('confirm sends a fill: 35=8 150=F 39=2 with LastQty/CumQty = order qty', async ({ loggedIn, api, tradeDetail, fixLog }) => {
    void loggedIn;
    const { mid } = await (await api.get('/api/prices/EURUSD')).json();
    const t = await (await api.post('/api/orders', { data: { instrument: 'EURUSD', side: 'buy', price: mid, quantity: 3000000, client: 'Bravo Bank', counterparty: 'EASTSEC' } })).json();
    await tradeDetail.goto(t.id);
    await tradeDetail.action('confirm').click();
    await expect(tradeDetail.status()).toHaveText('CONFIRMED');
    await fixLog.goto(t.id);
    await expect(fixLog.rows()).toHaveCount(3);
    await fixLog.rows().first().click(); // newest first
    expect(await fixLog.value(150)).toBe('F');
    expect(await fixLog.value(39)).toBe('2');
    expect(await fixLog.value(32)).toBe('3000000');
    expect(await fixLog.value(14)).toBe('3000000');
    expect(await fixLog.value(151)).toBe('0');
    expect(await fixLog.value(54)).toBe('1'); // 1 = Buy
  });
});
