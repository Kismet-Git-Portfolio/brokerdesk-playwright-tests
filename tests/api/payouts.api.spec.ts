import { test, expect } from '../../fixtures/test';

test.describe('Payouts API', () => {
  test('payout = sum of components', async ({ api }) => {
    const r = await api.post('/api/payouts', { data: { worker: 'w1', base: 0.1, allowance: 0.2, special: 0 } });
    expect(r.status()).toBe(201);
    expect((await r.json()).amount).toBe(0.3); // no floating point 0.30000000000000004
  });

  test('invalid payout is rejected', async ({ api }) => {
    const r = await api.post('/api/payouts', { data: { worker: 'w1', base: 'abc' } });
    expect(r.status()).toBe(400);
  });

  test('double submit with same Idempotency-Key pays once', async ({ api }) => {
    const headers = { 'Idempotency-Key': 'pay-key-1' };
    const data = { worker: 'w2', base: 500, allowance: 0, special: 0 };
    const [a, b] = await Promise.all([api.post('/api/payouts', { data, headers }), api.post('/api/payouts', { data, headers })]);
    expect([a.status(), b.status()].sort()).toEqual([200, 201]);
    const list = await (await api.get('/api/payouts')).json();
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(500);
  });
});
