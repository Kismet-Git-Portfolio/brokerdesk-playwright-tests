# How it works (beginner walkthrough)

## 1. The story

BrokerDesk is a pretend interdealer broker. Clients ask for prices (an RFQ), a broker books the trade by voice or on screen, the counterparty confirms, and then the trade settles, or fails and has to be chased. Every step leaves a record: a row in `trades`, FIX messages in `fix_messages`, a row in `settlements`, and lines in `audit`. QA's job is to prove those records agree with each other and with the screen.

## 2. Folder map

```
app/server.js              The whole mock app: APIs, market data simulator, FIX builder, lifecycle rules, SQLite, HTML pages.
app/public/*.js            Page scripts: overview, prices, ticket, blotter, trade (detail), fix (log viewer).
app/public/styles.css      Dark/teal design system with the moving background blobs.
sql/presets.js             Queries behind the Data checks buttons (sql/data-checks.sql has the same with comments).
pages/                     Page objects, one per screen.
fixtures/                  Custom fixtures (api, loggedIn, page objects), env credentials, random data.
tests/ui, tests/api        Browser tests and API tests.
scripts/                   Demo video + screenshot scripts.
.github/workflows/         CI.
```

## 3. Market data (price board)

`INSTRUMENTS` in `server.js` lists 8 instruments with a reference price, a tolerance band (%), decimals and a spread. `quote(symbol)` moves the mid price at most once a second, a small bounded wobble around the reference, and returns bid, ask, timestamp and `stale` (older than 5 seconds).

`POST /api/prices/:symbol/freeze` simulates a feed outage: the price stops moving and its timestamp is pushed into the past, so it reads STALE straight away. `/resume` brings it back. The *Simulate outage* button and the tests use the same hook.

## 4. Order ticket and validation

`POST /api/orders` (the ticket) runs `validateOrder` in this order: instrument, side, price > 0, quantity > 0, known instrument, client, counterparty, then the **market checks**: the price must not be stale, and it must be within ± tolerance % of the current mid. Failures are saved in `rejects`, which feeds the Overview KPI.

`POST /api/trades` is a quicker booking endpoint (client/counterparty optional). The older tests and the K6 script use it, and it applies the same market checks to known instruments.

**Idempotency:** the ticket sends an `Idempotency-Key` header and disables the button while a request is in flight. If the same key arrives twice, the server returns the first result (200, `duplicate: true`) instead of booking again.

## 5. Trade lifecycle

`TRANSITIONS` is the rulebook:

| Action | Allowed from | Goes to | FIX sent |
|---|---|---|---|
| book | – | NEW | 35=D, 35=8 150=0 39=0 |
| confirm | NEW | CONFIRMED | 35=8 150=F 39=2 (fill) |
| settle | CONFIRMED, FAILED | SETTLED | – (settlement row) |
| fail | CONFIRMED | FAILED | – (settlement row FAILED) |
| cancel | NEW, CONFIRMED | CANCELLED | 35=F, 35=8 150=4 39=4 |
| amend | NEW only | NEW | 35=G, 35=8 150=5 |

Anything else returns **409** and changes nothing. Every change writes an `audit` row.

## 6. FIX messages

`buildFix` writes real FIX 4.4 layout: `8=FIX.4.4`, then `9=` BodyLength (bytes from tag 35 up to the checksum), then the fields, then `10=` CheckSum (sum of all bytes mod 256, three digits). The separator is the SOH character; the UI shows it as `|`.

Key tags: 11 ClOrdID, 55 Symbol, 54 Side (1 buy, 2 sell), 38 OrderQty, 44 Price, 37 OrderID, 150 ExecType, 39 OrdStatus, 14 CumQty, 151 LeavesQty. `tests/api/fix.api.spec.ts` recomputes BodyLength and CheckSum itself, so a broken encoder fails the test.

## 7. Fixtures and page objects

- `api`: resets the DB (empty) before each test. Tests that need the seeded desk call `POST /api/reset?seed=demo`.
- `loggedIn`: signs in through the UI and checks we land on the Overview (`/`).
- `tradesPage.fill({...})` fills the ticket. Client and counterparty default to demo values; pass `''` to test the "required" errors.
- `fixLog.value(55)` reads a parsed tag's value; `tradeDetail.action('confirm')` gets a lifecycle button.

Locators use `getByTestId`, so styling changes never break tests. There are no fixed sleeps in the test suite except one 2-second wait that proves a stale price *doesn't* tick.

## 8. SQL data checks

`POST /api/sql` needs a session and runs exactly one read-only statement (`runReadOnly` uses better-sqlite3's `stmt.readonly`). Seeded breaks and the check that finds each one are listed in the README. Try:

- `SELECT * FROM settlements WHERE status = NULL` vs `... IS NULL`: the first returns nothing because NULL never equals anything.
- `SELECT msg_type, COUNT(*) FROM fix_messages GROUP BY msg_type`.
- `SELECT * FROM audit WHERE trade_id = 'T-1005'`.

## 9. Try this (break it on purpose)

1. **Remove idempotency:** in `app/public/ticket.js` delete `if (btn.disabled) return; btn.disabled = true;` and the `key` argument to `post`. Run `npx playwright test order-ticket`. The double-click test catches it.
2. **Widen the tolerance:** set BRENT's tolerance to 20 in `INSTRUMENTS`. The fat-finger test fails.
3. **Break FIX:** in `sendFix`, swap the side mapping (`'1'` for sell). The FIX tests fail on tag 54.
4. **Allow an illegal move:** add `'NEW'` to the `settle` row of `TRANSITIONS`. The lifecycle API test catches it.
5. **Debug visually:** `npx playwright test --ui`, or `npx playwright test --headed --debug tests/ui/fix-log.spec.ts`.

## 10. CI

On every push and PR, GitHub Actions installs Node 22, runs `npm ci`, installs Chromium, runs the suite and uploads the HTML report. With `CI` set, a failing test retries once and records a trace.
