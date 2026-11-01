# Demo (about 2 min)

Open the app and log in before the call.

1. Overview: practice project for QA on trade flows. Fake desk, the tests and data checks are the point.
2. Price board: click "Simulate outage" on Brent. It goes STALE and the ticket refuses orders on it.
3. Order ticket: EURUSD, enter qty, click Ask, pick client and counterparty, double-click Submit. One trade only. Then try price 1.20: rejected, outside tolerance.
4. FIX log: open the 35=D row. The test checks ClOrdID, symbol, side, qty and price match the ticket.
5. Trade: Confirm, then Settle. Both show in the audit trail. Settling before confirming is blocked.
6. Data checks: "Settlement breaks" (LEFT JOIN, missing ones are NULL), "Duplicate bookings" (GROUP BY HAVING COUNT > 1), then `DELETE FROM trades` to show it's read-only.
7. Close: 83 tests, UI and API, run in CI on every push.

Seeded breaks (`POST /api/reset?seed=demo`):
- BRK-318: T-1004, T-1006 no settlement, T-1005 failed
- BRK-322: T-1008 duplicates T-1002
- BRK-327: cancelled T-1007 is in the DB but not on the blotter
- BRK-411: T-1003 fill qty 3 vs trade 30, T-1006 no exec report
- BRK-415: Brent T-1009 booked 11.77% off reference
- GIG-322: gig payout paid twice
