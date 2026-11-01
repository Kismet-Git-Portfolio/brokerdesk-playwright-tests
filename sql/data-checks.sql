-- BrokerDesk data checks (same queries as the buttons on /data-checks). Run against the demo DB.

-- BRK-318: Settlement breaks
SELECT t.trade_id, t.counterparty, t.instrument, t.notional, s.status AS settlement_status
FROM trades t
LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
  AND (s.trade_id IS NULL OR s.status <> 'SETTLED')
ORDER BY t.trade_id;

-- BRK-322: Duplicate bookings
SELECT client, instrument, side, quantity, price, COUNT(*) AS times_booked,
       GROUP_CONCAT(trade_id) AS trade_ids
FROM trades
WHERE status <> 'CANCELLED'
GROUP BY client, instrument, side, quantity, price, trade_date
HAVING COUNT(*) > 1;

-- BRK-318: INNER vs LEFT JOIN
SELECT 'INNER JOIN' AS join_type, COUNT(*) AS rows_returned
FROM trades t INNER JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
UNION ALL
SELECT 'LEFT JOIN', COUNT(*)
FROM trades t LEFT JOIN settlements s ON s.trade_id = t.trade_id
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED');

-- BRK-327: Blotter vs DB reconciliation
SELECT status, CASE WHEN status = 'CANCELLED' THEN 'no' ELSE 'yes' END AS on_blotter,
       COUNT(*) AS trades, ROUND(SUM(notional), 2) AS total_notional
FROM trades
GROUP BY status
UNION ALL
SELECT 'ALL (DB)', '-', COUNT(*), ROUND(SUM(notional), 2) FROM trades;

-- BRK-411: FIX exec reports vs trades
SELECT t.trade_id, t.instrument, t.quantity AS trade_qty, er.qty AS fix_qty,
       t.price AS trade_px, er.price AS fix_px,
       CASE WHEN er.fix_id IS NULL THEN 'NO EXEC REPORT' ELSE 'QTY/PX MISMATCH' END AS issue
FROM trades t
LEFT JOIN fix_messages er
  ON er.trade_id = t.trade_id AND er.msg_type = '8' AND er.exec_type = 'F'
WHERE t.status IN ('CONFIRMED', 'SETTLED', 'FAILED')
  AND (er.fix_id IS NULL OR er.qty <> t.quantity OR er.price <> t.price)
ORDER BY t.trade_id;

-- BRK-415: Price outside tolerance
SELECT t.trade_id, t.instrument, t.price, i.ref_price,
       ROUND(ABS(t.price - i.ref_price) / i.ref_price * 100, 2) AS pct_off,
       i.tolerance_pct
FROM trades t
JOIN instruments i ON i.symbol = t.instrument
WHERE ABS(t.price - i.ref_price) / i.ref_price * 100 > i.tolerance_pct
ORDER BY pct_off DESC;

-- BRK-420: Rejects by reason
SELECT reason, COUNT(*) AS rejects
FROM rejects
GROUP BY reason
ORDER BY rejects DESC;

-- GIG-322: Duplicate payouts (gig)
SELECT worker, shift_ref, COUNT(*) AS times_paid, SUM(amount) AS total_paid
FROM payouts
GROUP BY worker, shift_ref
HAVING COUNT(*) > 1;

