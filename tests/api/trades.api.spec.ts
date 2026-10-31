import { test, expect } from '../../fixtures/test';

test.describe('Trades API', () => {
  for (const [price, quantity] of [[-1, 1], [0, 1], ['x', 1], [1, -1], [1, 0], [1, 'y']]) {
    test(`rejects price=${price} qty=${quantity}`, async ({ api }) => {
      const r = await api.post('/api/trades', { data: { instrument: 'EURUSD', side: 'buy', price, quantity } });
      expect(r.status()).toBe(400);
    });
  }

  for (const [price, quantity, notional] of [[1.1, 3, 3.3], [0.1, 0.2, 0.02], [1.005, 1000, 1005], [99.995, 1, 100]]) {
    test(`notional ${price} x ${quantity} = ${notional}`, async ({ api }) => {
      const r = await api.post('/api/trades', { data: { instrument: 'X', side: 'sell', price, quantity } });
      expect((await r.json()).notional).toBe(notional);
    });
  }

  test('same Idempotency-Key creates one trade', async ({ api }) => {
    const opts = { data: { instrument: 'EURUSD', side: 'buy', price: 1.08, quantity: 100 }, headers: { 'Idempotency-Key': 'trd-key-1' } };
    await Promise.all([api.post('/api/trades', opts), api.post('/api/trades', opts)]);
    expect(await (await api.get('/api/trades')).json()).toHaveLength(1);
  });

  test('side filter', async ({ api }) => {
    await api.post('/api/trades', { data: { instrument: 'A', side: 'buy', price: 1, quantity: 1 } });
    await api.post('/api/trades', { data: { instrument: 'B', side: 'sell', price: 1, quantity: 1 } });
    const sells = await (await api.get('/api/trades?side=sell')).json();
    expect(sells.map((t: any) => t.instrument)).toEqual(['B']);
  });
});
