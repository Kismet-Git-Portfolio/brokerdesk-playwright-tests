import { test, expect } from '../../fixtures/test';
import { creds } from '../../fixtures/env';

const order = { instrument: 'EURUSD', side: 'buy', quantity: 1000000, client: 'Alpha Capital', counterparty: 'NORTHBANK' };

test.describe('API status codes', () => {
  test('201 order booked', async ({ api }) => {
    const mid = (await (await api.get('/api/prices/EURUSD')).json()).mid;
    const r = await api.post('/api/orders', { data: { ...order, price: mid } });
    expect(r.status()).toBe(201);
    const body = await r.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe('NEW');
  });

  test('204 draft deleted', async ({ api }) => {
    const draft = await (await api.post('/api/drafts', { data: { instrument: 'EURUSD', side: 'buy', quantity: 500000 } })).json();
    const r = await api.delete(`/api/drafts/${draft.id}`);
    expect(r.status()).toBe(204);
    expect(await r.text()).toBe('');
  });

  test('400 malformed json', async ({ api }) => {
    const r = await api.post('/api/orders', { data: '{"instrument": "EURUSD",', headers: { 'Content-Type': 'application/json' } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBe('Malformed JSON');
  });

  test('401 sql console without signing in', async ({ api }) => {
    const r = await api.post('/api/sql', { data: { query: 'SELECT * FROM trades' } });
    expect(r.status()).toBe(401);
    expect((await r.json()).error).toBe('Sign in required');
  });

  test('403 trader calls admin endpoint', async ({ api }) => {
    await api.post('/api/login', { data: { username: creds.user, password: creds.password } });
    const r = await api.post('/api/admin/limits', { data: { maxNotional: 1 } });
    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.error).toBe('Admin role required');
    expect(body.role).toBe('trader');
    await api.post('/api/logout');
  });

  test('404 unknown trade id', async ({ api }) => {
    const r = await api.get('/api/trades/T-DOESNOTEXIST');
    expect(r.status()).toBe(404);
    expect((await r.json()).error).toBe('Trade not found');
  });

  test('422 draft with negative quantity', async ({ api }) => {
    const r = await api.post('/api/drafts', { data: { instrument: 'EURUSD', side: 'buy', quantity: -100 } });
    expect(r.status()).toBe(422);
    const body = await r.json();
    expect(body.code).toBe('VALIDATION');
    expect(body.error).toBe('Quantity must be a positive number');
  });

  test('500 fault injection route', async ({ api }) => {
    const r = await api.get('/api/test/fault');
    expect(r.status()).toBe(500);
    expect((await r.json()).error).toBe('Internal server error');
  });
});
