// Preset data-check queries shown as buttons on /data-checks. Same stories as sql/data-checks.sql.
module.exports = [
  { key: 'missing', ticket: 'BRK-318', title: 'Settlement breaks', why: 'LEFT JOIN keeps every confirmed trade, so trades with no settlement come back as NULL. INNER JOIN would hide them.',
    sql: `SELECT t.trade_id, t.counterparty, t.instrument, t.notional, s.status AS settlement_status
FROM trades t
LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
  AND (s.trade_id IS NULL OR s.status <> 'SETTLED')
ORDER BY t.trade_id;` },
  { key: 'dupes', ticket: 'BRK-322', title: 'Duplicate bookings', why: 'GROUP BY the economic key (client, instrument, side, qty, price, date) and HAVING COUNT(*) > 1 shows a trade booked twice.',
    sql: `SELECT client, instrument, side, quantity, price, COUNT(*) AS times_booked,
       GROUP_CONCAT(trade_id) AS trade_ids
FROM trades
WHERE status <> 'CANCELLED'
GROUP BY client, instrument, side, quantity, price, trade_date
HAVING COUNT(*) > 1;` },
  { key: 'joins', ticket: 'BRK-318', title: 'INNER vs LEFT JOIN', why: 'Same tables, two joins. The row-count gap is exactly the confirmed trades that have no settlement.',
    sql: `SELECT 'INNER JOIN' AS join_type, COUNT(*) AS rows_returned
FROM trades t INNER JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
UNION ALL
SELECT 'LEFT JOIN', COUNT(*)
FROM trades t LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED');` },
  { key: 'recon', ticket: 'BRK-327', title: 'Blotter vs DB reconciliation', why: 'The blotter hides CANCELLED trades. Totals per status explain a "missing" trade and must add up to the DB total.',
    sql: `SELECT status, CASE WHEN status = 'CANCELLED' THEN 'no' ELSE 'yes' END AS on_blotter,
       COUNT(*) AS trades, ROUND(SUM(notional), 2) AS total_notional
FROM trades
GROUP BY status
UNION ALL
SELECT 'ALL (DB)', '-', COUNT(*), ROUND(SUM(notional), 2) FROM trades;` },
  { key: 'fix', ticket: 'BRK-411', title: 'FIX exec reports vs trades', why: 'Every confirmed trade needs a fill (35=8, 150=F) whose qty and price equal the booking. LEFT JOIN also finds missing reports.',
    sql: `SELECT t.trade_id, t.instrument, t.quantity AS trade_qty, er.qty AS fix_qty,
       t.price AS trade_px, er.price AS fix_px,
       CASE WHEN er.fix_id IS NULL THEN 'NO EXEC REPORT' ELSE 'QTY/PX MISMATCH' END AS issue
FROM trades t
LEFT JOIN fix_messages er
  ON er.trade_id = t.trade_id AND er.msg_type = '8' AND er.exec_type = 'F'
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
  AND (er.fix_id IS NULL OR er.qty <> t.quantity OR er.price <> t.price)
ORDER BY t.trade_id;` },
  { key: 'tolerance', ticket: 'BRK-415', title: 'Price outside tolerance', why: 'Fat-finger check: compare each booked price with the instrument reference price and its tolerance band.',
    sql: `SELECT t.trade_id, t.instrument, t.price, i.ref_price,
       ROUND(ABS(t.price - i.ref_price) / i.ref_price * 100, 2) AS pct_off,
       i.tolerance_pct
FROM trades t
JOIN instruments i ON i.symbol = t.instrument
WHERE ABS(t.price - i.ref_price) / i.ref_price * 100 > i.tolerance_pct
ORDER BY pct_off DESC;` },
  { key: 'rejects', ticket: 'BRK-420', title: 'Rejects by reason', why: 'What is the ticket blocking? GROUP BY reason shows whether rejects are user error, tolerance or stale data.',
    sql: `SELECT reason, COUNT(*) AS rejects
FROM rejects
GROUP BY reason
ORDER BY rejects DESC;` },
  { key: 'paydupes', ticket: 'GIG-322', gig: true, title: 'Duplicate payouts (gig)', why: 'Prior-work example: GROUP BY worker + shift and HAVING COUNT(*) > 1 shows anything paid twice.',
    sql: `SELECT worker, shift_ref, COUNT(*) AS times_paid, SUM(amount) AS total_paid
FROM payouts
GROUP BY worker, shift_ref
HAVING COUNT(*) > 1;` },
];
