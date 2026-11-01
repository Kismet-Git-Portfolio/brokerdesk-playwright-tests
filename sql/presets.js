// Preset data-check queries shown as buttons on /data-checks. Same stories as sql/data-checks.sql.
module.exports = [
  { key: 'missing', ticket: 'QA-318', title: 'Missing / failed settlements', why: 'LEFT JOIN keeps every trade, so trades with no settlement come back with NULLs. INNER JOIN would hide them.',
    sql: `SELECT t.trade_id, t.client, t.instrument, t.notional, s.status AS settlement_status
FROM trades t
LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status = 'LIVE'
  AND (s.trade_id IS NULL OR s.status <> 'SETTLED')
ORDER BY t.trade_id;` },
  { key: 'dupes', ticket: 'QA-322', title: 'Duplicate payouts', why: 'GROUP BY the business key (worker + shift) and HAVING COUNT(*) > 1 shows anything paid twice.',
    sql: `SELECT worker, shift_ref, COUNT(*) AS times_paid, SUM(amount) AS total_paid
FROM payouts
GROUP BY worker, shift_ref
HAVING COUNT(*) > 1;` },
  { key: 'joins', ticket: 'QA-318', title: 'INNER vs LEFT JOIN', why: 'Same tables, two joins. The row-count gap is exactly the trades that have no settlement.',
    sql: `SELECT 'INNER JOIN' AS join_type, COUNT(*) AS rows_returned
FROM trades t INNER JOIN settlements s ON s.trade_id = t.trade_id
UNION ALL
SELECT 'LEFT JOIN', COUNT(*)
FROM trades t LEFT JOIN settlements s ON s.trade_id = t.trade_id;` },
  { key: 'recon', ticket: 'QA-327', title: 'Blotter total reconciliation', why: 'The blotter only shows LIVE trades. Compare the DB with and without that filter to explain a "missing" trade.',
    sql: `SELECT status, COUNT(*) AS trades, ROUND(SUM(notional), 2) AS total_notional
FROM trades
GROUP BY status
UNION ALL
SELECT 'ALL (DB)', COUNT(*), ROUND(SUM(notional), 2) FROM trades;` },
];
