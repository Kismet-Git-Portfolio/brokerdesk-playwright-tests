import { test, expect } from '../../fixtures/test';
import { creds } from '../../fixtures/env';

test.describe('SQL endpoint', () => {
  test('requires a session', async ({ api }) => {
    const r = await api.post('/api/sql', { data: { query: 'SELECT 1' }, headers: { cookie: '' } });
    expect(r.status()).toBe(401);
  });

  test('booked trade via API is persisted in the DB with correct notional', async ({ api }) => {
    await api.post('/api/login', { data: { username: creds.user, password: creds.password } });
    const t = await (await api.post('/api/trades', { data: { instrument: 'gbpusd', side: 'buy', price: 1.2734, quantity: 1000 } })).json();
    const r = await api.post('/api/sql', { data: { query: `SELECT instrument, notional, status FROM trades WHERE trade_id = '${t.id}'` } });
    expect((await r.json()).rows).toEqual([['GBPUSD', 1273.4, 'NEW']]);
  });
});
