import { test, expect } from '../../fixtures/test';

const order = (o: Record<string, unknown> = {}) => ({ instrument: 'EURUSD', side: 'buy', quantity: 1000000, client: 'Alpha Capital', counterparty: 'NORTHBANK', ...o });
const mid = async (api: any, sym: string) => (await (await api.get(`/api/prices/${sym}`)).json()).mid as number;

test.describe('Orders + market data API', () => {
  test('prices: all 8 instruments, bid < ask, ISO timestamp, not stale', async ({ api }) => {
    const q = await (await api.get('/api/prices')).json();
    expect(q.map((p: any) => p.symbol)).toEqual(['EURUSD', 'GBPUSD', 'USDJPY', 'UST10Y', 'BUND10Y', 'IG-CDS-5Y', 'BRENT', 'XAUUSD']);
    for (const p of q) { expect(p.bid).toBeLessThan(p.ask); expect(Date.parse(p.ts)).not.toBeNaN(); expect(p.stale).toBe(false); }
  });

  test('tolerance band: inside accepted (201), outside rejected (400 PRICE_TOLERANCE)', async ({ api }) => {
    const m = await mid(api, 'EURUSD');
    expect((await api.post('/api/orders', { data: order({ price: +(m * 1.003).toFixed(5) }) })).status()).toBe(201);
    const r = await api.post('/api/orders', { data: order({ price: +(m * 1.02).toFixed(5) }) });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('PRICE_TOLERANCE');
  });

  test('stale price blocks orders (400 STALE_PRICE) until the feed recovers', async ({ api }) => {
    const m = await mid(api, 'BUND10Y');
    await api.post('/api/prices/BUND10Y/freeze');
    const r = await api.post('/api/orders', { data: order({ instrument: 'BUND10Y', price: m, quantity: 10 }) });
    expect(r.status()).toBe(400);
    expect((await r.json()).code).toBe('STALE_PRICE');
    await api.post('/api/prices/BUND10Y/resume');
    expect((await api.post('/api/orders', { data: order({ instrument: 'BUND10Y', price: await mid(api, 'BUND10Y'), quantity: 10 }) })).status()).toBe(201);
  });

  for (const [label, o, msg] of [
    ['unknown instrument', { instrument: 'FOO' }, 'Unknown instrument FOO'],
    ['missing client', { client: '' }, 'Client is required'],
    ['missing counterparty', { counterparty: undefined }, 'Counterparty is required'],
    ['bad side', { side: 'hold' }, 'Side must be buy or sell'],
    ['zero qty', { quantity: 0 }, 'Quantity must be a positive number'],
  ] as const) {
    test(`RFQ rejects ${label}`, async ({ api }) => {
      const r = await api.post('/api/orders', { data: order({ price: await mid(api, 'EURUSD'), ...o }) });
      expect(r.status()).toBe(400);
      expect((await r.json()).error).toBe(msg);
    });
  }

  test('same Idempotency-Key on /api/orders: one trade, second call flagged duplicate', async ({ api }) => {
    const opts = { data: order({ price: await mid(api, 'EURUSD') }), headers: { 'Idempotency-Key': 'rfq-key-1' } };
    const [a, b] = await Promise.all([api.post('/api/orders', opts), api.post('/api/orders', opts)]);
    expect([a.status(), b.status()].sort()).toEqual([200, 201]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies[0].id).toBe(bodies[1].id);
    expect(await (await api.get('/api/trades')).json()).toHaveLength(1);
  });
});
