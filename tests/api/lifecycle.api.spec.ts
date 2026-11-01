import { test, expect } from '../../fixtures/test';

const book = async (api: any) => {
  const { mid } = await (await api.get('/api/prices/GBPUSD')).json();
  return (await api.post('/api/orders', { data: { instrument: 'GBPUSD', side: 'sell', price: mid, quantity: 250000, client: 'Echo Hedge Partners', counterparty: 'SOUTHMARKETS' } })).json();
};

test.describe('Lifecycle API', () => {
  test('allowed transitions return the new status', async ({ api }) => {
    const t = await book(api);
    for (const [a, s] of [['confirm', 'CONFIRMED'], ['fail', 'FAILED'], ['settle', 'SETTLED']]) {
      const r = await api.post(`/api/trades/${t.id}/${a}`);
      expect(r.status(), a).toBe(200);
      expect((await r.json()).status).toBe(s);
    }
    const { rows } = { rows: (await (await api.get(`/api/trades/${t.id}`)).json()).audit.map((x: any) => `${x.from_status}->${x.to_status}`) };
    expect(rows).toEqual(['null->NEW', 'NEW->CONFIRMED', 'CONFIRMED->FAILED', 'FAILED->SETTLED']);
  });

  for (const [setup, action] of [[[], 'settle'], [[], 'fail'], [['confirm', 'settle'], 'cancel'], [['cancel'], 'confirm'], [['confirm'], 'amend']] as const) {
    test(`illegal: ${action} after [${setup.join(', ') || 'NEW'}] → 409, nothing changes`, async ({ api }) => {
      const t = await book(api);
      for (const a of setup) await api.post(`/api/trades/${t.id}/${a}`);
      const before = await (await api.get(`/api/trades/${t.id}`)).json();
      const r = await api.post(`/api/trades/${t.id}/${action}`, { data: { quantity: 1 } });
      expect(r.status()).toBe(409);
      const after = await (await api.get(`/api/trades/${t.id}`)).json();
      expect(after.status).toBe(before.status);
      expect(after.audit).toHaveLength(before.audit.length);
    });
  }

  test('amend outside tolerance is rejected and the trade is unchanged', async ({ api }) => {
    const t = await book(api);
    const r = await api.post(`/api/trades/${t.id}/amend`, { data: { price: t.price * 1.5 } });
    expect(r.status()).toBe(400);
    expect((await (await api.get(`/api/trades/${t.id}`)).json()).price).toBe(t.price);
  });

  test('unknown trade → 404', async ({ api }) => {
    expect((await api.post('/api/trades/NOPE/confirm')).status()).toBe(404);
  });
});
