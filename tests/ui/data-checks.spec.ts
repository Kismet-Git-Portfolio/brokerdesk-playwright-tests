import { test, expect } from '../../fixtures/test';
import { creds } from '../../fixtures/env';

// Seeded demo DB with deliberate breaks: BRK-318 / 322 / 327 / 411 / 415 and GIG-322.
test.beforeEach(async ({ loggedIn, api }) => { void loggedIn; await api.post('/api/reset?seed=demo');
  await api.post('/api/login', { data: { username: creds.user, password: creds.password } }); // API client needs its own session for /api/sql
});

test('UI blotter matches the DB query (row by row)', async ({ tradesPage, api }) => {
  const sql = await api.post('/api/sql', { data: { query: "SELECT trade_id, instrument, side, notional FROM trades WHERE status <> 'CANCELLED' ORDER BY seq" } });
  expect(sql.ok()).toBeTruthy();
  const { rows } = await sql.json();
  await tradesPage.goto();
  await expect(tradesPage.rows()).toHaveCount(rows.length);
  for (const [id, instrument, side, notional] of rows) {
    const row = tradesPage.row(id);
    await expect(row.getByTestId('trade-row-instrument')).toHaveText(instrument);
    await expect(row.getByTestId('trade-row-side')).toHaveText(side);
    await expect(row.getByTestId('trade-row-notional')).toHaveText(Number(notional).toFixed(2));
  }
});

test('BRK-327 blotter reconciles with DB: cancelled trade explains the gap', async ({ dataChecks, api }) => {
  await dataChecks.goto();
  await dataChecks.preset('recon');
  const t = await dataChecks.table();
  const onBlotter = t.filter((r) => r[1] === 'yes'), all = t.find((r) => r[0] === 'ALL (DB)')!, cancelled = t.find((r) => r[0] === 'CANCELLED')!;
  const blotter = await (await api.get('/api/trades')).json();
  const uiTotal = Math.round(blotter.reduce((s: number, x: any) => s + x.notional, 0) * 100) / 100;
  expect(onBlotter.reduce((s, r) => s + Number(r[2]), 0)).toBe(blotter.length);
  expect(onBlotter.reduce((s, r) => s + Number(r[3]), 0)).toBeCloseTo(uiTotal, 2);
  expect(Number(all[3])).toBeCloseTo(uiTotal + Number(cancelled[3]), 2);
  expect(Number(all[2])).toBe(blotter.length + 1);
});

test('BRK-318 settlement check finds the unsettled and failed trades', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('missing');
  const t = await dataChecks.table();
  expect(t.map((r) => [r[0], r[4]])).toEqual([['T-1004', 'NULL'], ['T-1005', 'FAILED'], ['T-1006', 'NULL']]);
});

test('BRK-322 duplicate booking check finds T-1002 / T-1008', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('dupes');
  const t = await dataChecks.table();
  expect(t).toHaveLength(1);
  expect(t[0][0]).toBe('Bravo Bank');
  expect(t[0][5]).toBe('2');
  expect(t[0][6].split(',').sort()).toEqual(['T-1002', 'T-1008']);
});

test('INNER vs LEFT JOIN row counts differ by the unsettled trades', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('joins');
  const [[, inner], [, left]] = await dataChecks.table();
  expect(Number(left) - Number(inner)).toBe(2);
});

test('BRK-411 FIX vs trades check flags the qty mismatch and the missing exec report', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('fix');
  const t = await dataChecks.table();
  expect(t.map((r) => [r[0], r[2], r[3], r[6]])).toEqual([['T-1003', '30', '3', 'QTY/PX MISMATCH'], ['T-1006', '40', 'NULL', 'NO EXEC REPORT']]);
});

test('BRK-415 tolerance check flags the fat-finger Brent trade only', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('tolerance');
  const t = await dataChecks.table();
  expect(t.map((r) => [r[0], r[1], r[4]])).toEqual([['T-1009', 'BRENT', '11.77']]);
});

test('GIG-322 (prior work) duplicate payout check still finds the double payment', async ({ dataChecks }) => {
  await dataChecks.goto();
  await dataChecks.preset('paydupes');
  expect((await dataChecks.table()).map((r) => r.slice(0, 3))).toEqual([['Ben Cruz', 'shift-B7', '2']]);
});

test('a trade booked on the ticket shows up in the checks immediately (clean trade = no breaks)', async ({ tradesPage, dataChecks, api }) => {
  const mid = (await (await api.get('/api/prices/EURUSD')).json()).mid;
  await tradesPage.goto();
  await tradesPage.fill({ instrument: 'EURUSD', side: 'buy', price: String(mid), quantity: '1000000' });
  await tradesPage.submit().click();
  const id = (await tradesPage.confirmedId());
  await dataChecks.goto();
  await dataChecks.run(`SELECT t.status, COUNT(f.fix_id) FROM trades t JOIN fix_messages f ON f.trade_id = t.trade_id WHERE t.trade_id = '${id}' GROUP BY t.status`);
  expect(await dataChecks.table()).toEqual([['NEW', '2']]); // 35=D + 35=8 (New)
});

test('console rejects non-SELECT statements and leaves data untouched', async ({ dataChecks, api }) => {
  await dataChecks.goto();
  for (const q of ['DELETE FROM trades', "UPDATE trades SET price = 0", 'DROP TABLE settlements', 'SELECT 1; DELETE FROM trades',
    "INSERT INTO trades (trade_id) VALUES ('X')", 'WITH x AS (SELECT 1) DELETE FROM trades', 'PRAGMA writable_schema = 1']) {
    await dataChecks.run(q);
    await expect(dataChecks.error()).toHaveText(/Only SELECT|Only one statement/);
  }
  const r = await api.post('/api/sql', { data: { query: 'SELECT COUNT(*) FROM trades' } });
  expect((await r.json()).rows[0][0]).toBe(11);
});
