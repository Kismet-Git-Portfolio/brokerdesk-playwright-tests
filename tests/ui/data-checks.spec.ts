import { test, expect } from '../../fixtures/test';
import { DataChecksPage } from '../../pages/DataChecksPage';
import { TradesPage } from '../../pages/TradesPage';
import { creds } from '../../fixtures/env';

// Seeded demo DB: deliberate defects for QA-318 / QA-322 / QA-327.
test.beforeEach(async ({ loggedIn, api }) => { void loggedIn; await api.post('/api/reset?seed=demo');
  await api.post('/api/login', { data: { username: creds.user, password: creds.password } }); // API client needs its own session for /api/sql
});

test('UI blotter matches the DB query (row by row)', async ({ page, tradesPage, api }) => {
  const sql = await api.post('/api/sql', { data: { query: "SELECT trade_id, instrument, side, notional FROM trades WHERE status = 'LIVE' ORDER BY seq" } });
  expect(sql.ok()).toBeTruthy();
  const { rows } = await sql.json();
  await tradesPage.goto();
  await expect(tradesPage.rows()).toHaveCount(rows.length);
  for (const [id, instrument, side, notional] of rows) {
    const row = (tradesPage as TradesPage).row(id);
    await expect(row.getByTestId('trade-row-instrument')).toHaveText(instrument);
    await expect(row.getByTestId('trade-row-side')).toHaveText(side);
    await expect(row.getByTestId('trade-row-notional')).toHaveText(Number(notional).toFixed(2));
  }
  void page;
});

test('blotter total reconciles with DB: cancelled trade explains the gap', async ({ page, api }) => {
  const dc = new DataChecksPage(page);
  await dc.goto();
  await dc.preset('recon');
  const t = await dc.table();
  const live = t.find((r) => r[0] === 'LIVE')!, all = t.find((r) => r[0] === 'ALL (DB)')!, cancelled = t.find((r) => r[0] === 'CANCELLED')!;
  const blotter = await (await api.get('/api/trades')).json();
  const uiTotal = Math.round(blotter.reduce((s: number, x: any) => s + x.notional, 0) * 100) / 100;
  expect(Number(live[1])).toBe(blotter.length);
  expect(Number(live[2])).toBeCloseTo(uiTotal, 2);
  expect(Number(all[2])).toBeCloseTo(Number(live[2]) + Number(cancelled[2]), 2);
});

test('QA-318 data check finds the seeded missing and failed settlements', async ({ page }) => {
  const dc = new DataChecksPage(page);
  await dc.goto();
  await dc.preset('missing');
  const t = await dc.table();
  expect(t.map((r) => [r[0], r[4]])).toEqual([['T-1004', 'NULL'], ['T-1005', 'FAILED'], ['T-1006', 'NULL']]);
});

test('QA-322 data check finds the duplicate payout', async ({ page }) => {
  const dc = new DataChecksPage(page);
  await dc.goto();
  await dc.preset('dupes');
  expect((await dc.table()).map((r) => r.slice(0, 3))).toEqual([['Ben Cruz', 'shift-B7', '2']]);
});

test('INNER vs LEFT JOIN row counts differ by the unsettled trades', async ({ page }) => {
  const dc = new DataChecksPage(page);
  await dc.goto();
  await dc.preset('joins');
  const [[, inner], [, left]] = await dc.table();
  expect(Number(left) - Number(inner)).toBe(2);
});

test('console rejects non-SELECT statements and leaves data untouched', async ({ page, api }) => {
  const dc = new DataChecksPage(page);
  await dc.goto();
  for (const q of ['DELETE FROM trades', "UPDATE payouts SET amount = 0", 'DROP TABLE settlements', 'SELECT 1; DELETE FROM trades',
    "INSERT INTO trades VALUES ('X','A','buy',1,1,1,null,'LIVE',99)", 'WITH x AS (SELECT 1) DELETE FROM trades', 'PRAGMA writable_schema = 1']) {
    await dc.run(q);
    await expect(dc.error()).toHaveText(/Only SELECT|Only one statement/);
  }
  const r = await api.post('/api/sql', { data: { query: 'SELECT COUNT(*) FROM trades' } });
  expect((await r.json()).rows[0][0]).toBe(7);
});
