import { test, expect } from '../../fixtures/test';
import { uniq } from '../../fixtures/data';

// The "double-payout" check: expected (from test data) == API == UI.
test('payout amount matches in UI, API and expected sum', async ({ loggedIn, api, payoutsPage }) => {
  void loggedIn;
  const comp = { base: 1500, allowance: 250.75, special: 99.99 };
  const expected = 1850.74;
  const created = await (await api.post('/api/payouts', { data: { worker: uniq('worker'), ...comp } })).json();

  const list = await (await api.get('/api/payouts')).json();
  const fromApi = list.find((p: any) => p.id === created.id);
  expect(fromApi.amount).toBe(expected);
  expect(fromApi.amount).not.toBe(expected * 2);

  await payoutsPage.goto();
  await expect(payoutsPage.amountFor(created.id)).toHaveText(expected.toFixed(2));
});
