# Notes

`app/server.js` is the whole app: API, fake prices, FIX builder, lifecycle rules, SQLite schema and seed data. Page scripts are in `app/public/`.

Prices: `INSTRUMENTS` has 8 instruments with a reference price and tolerance %. `quote()` moves the price at most once a second. A price older than 5s is stale. `POST /api/prices/:symbol/freeze` and `/resume` are test hooks for a feed outage.

Orders: `POST /api/orders` validates fields, then checks the price is fresh and within tolerance. Rejects are saved to `rejects`. The ticket sends an `Idempotency-Key`, and a repeated key returns the first result instead of booking again.

Lifecycle (`TRANSITIONS`):
- confirm: NEW -> CONFIRMED (sends fill)
- settle: CONFIRMED/FAILED -> SETTLED
- fail: CONFIRMED -> FAILED
- cancel: NEW/CONFIRMED -> CANCELLED (35=F)
- amend: NEW only (35=G)

Anything else is a 409. Every change writes an audit row.

FIX: `buildFix` writes FIX 4.4 with BodyLength (9) and CheckSum (10). `tests/api/fix.api.spec.ts` recomputes both.

Fixtures: `api` resets the DB to empty before each test, `loggedIn` signs in through the UI. Locators use test ids.

SQL page: `POST /api/sql` needs a session and runs one statement with better-sqlite3's readonly check.

Things to break on purpose to see a test fail:
- remove the button lock and idempotency key in `app/public/ticket.js` -> order-ticket double-click test
- set Brent tolerance to 20 -> fat-finger test
- add NEW to settle in `TRANSITIONS` -> lifecycle API test
