-- ShiftDesk QA Showcase: SQL data checks
-- Runs against the app's in-memory SQLite DB (tables: trades, settlements, payouts).
-- Try them live at http://localhost:3100/data-checks (read-only console, SELECT only).
-- Idea: the UI and API can look right while the data behind them is wrong. These checks verify the data layer.

-- =====================================================================
-- QA-318  "Some trades never settled"
-- Story: Ops reports trades where cash and asset were never exchanged.
-- Why LEFT JOIN: it keeps every trade. Trades with no settlement row come back
-- with NULL settlement columns. An INNER JOIN would silently drop them, so the
-- bug would be invisible. Note: "= NULL" never matches; use IS NULL.
-- Expected on demo data: T-1004, T-1006 (NULL, no settlement), T-1005 (FAILED).
-- =====================================================================
SELECT t.trade_id, t.client, t.instrument, t.notional, s.status AS settlement_status
FROM trades t
LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status = 'LIVE'
  AND (s.trade_id IS NULL OR s.status <> 'SETTLED')
ORDER BY t.trade_id;

-- INNER vs LEFT JOIN, side by side. The gap in row counts = trades with no settlement.
SELECT 'INNER JOIN' AS join_type, COUNT(*) AS rows_returned
FROM trades t INNER JOIN settlements s ON s.trade_id = t.trade_id
UNION ALL
SELECT 'LEFT JOIN', COUNT(*)
FROM trades t LEFT JOIN settlements s ON s.trade_id = t.trade_id;

-- =====================================================================
-- QA-322  "Worker says they were paid twice"
-- Story: the UI double-click test proves the button is idempotent, but did an
-- older batch job already write a duplicate? Group by the business key.
-- Expected on demo data: Ben Cruz / shift-B7 paid 2 times.
-- =====================================================================
SELECT worker, shift_ref, COUNT(*) AS times_paid, SUM(amount) AS total_paid
FROM payouts
GROUP BY worker, shift_ref
HAVING COUNT(*) > 1;

-- Show the duplicate rows themselves so the dev can see both IDs (window function).
SELECT payout_id, worker, shift_ref, amount,
       ROW_NUMBER() OVER (PARTITION BY worker, shift_ref ORDER BY payout_id) AS nth_payment
FROM payouts
ORDER BY worker, shift_ref;

-- =====================================================================
-- QA-327  "Trade is in the database but not on the blotter / report"
-- Story: the blotter total doesn't match the DB total. Reconcile by status.
-- The blotter shows LIVE trades only, so a CANCELLED trade explains the gap
-- (expected behaviour, not a bug, once confirmed with the BA).
-- =====================================================================
SELECT status, COUNT(*) AS trades, ROUND(SUM(notional), 2) AS total_notional
FROM trades
GROUP BY status
UNION ALL
SELECT 'ALL (DB)', COUNT(*), ROUND(SUM(notional), 2) FROM trades;

-- What the blotter should show (UI vs DB check: compare row-by-row with the screen).
SELECT trade_id, instrument, side, price, quantity, notional
FROM trades
WHERE status = 'LIVE'
ORDER BY seq;

-- Notional math check: any row where stored notional != price * quantity (2 dp)?
SELECT trade_id, price, quantity, notional, ROUND(price * quantity, 2) AS expected
FROM trades
WHERE ABS(notional - ROUND(price * quantity, 2)) > 0.001;
