# BrokerDesk QA Showcase (Playwright + TypeScript)

![Playwright Tests](https://github.com/<your-username>/<repo-name>/actions/workflows/playwright.yml/badge.svg)
<!-- Replace <your-username>/<repo-name> after pushing to GitHub -->

A self-contained QA automation showcase built around a **mock interdealer-broker trading desk**: rates, FX, credit, energy and commodities, booked by voice or electronically. The app is plain Node + Express with an in-memory SQLite DB and vanilla JS pages (no build step). Playwright starts it by itself, so `npx playwright test` is all you need.

Everything is fake demo data. It's a practice project, not a copy of any firm's system.

| Screen | What it does | What the tests prove |
|---|---|---|
| **Overview** `/` | KPIs (trades today, unsettled/failed, rejects, FIX messages), notional by asset class, market snapshot | KPIs match the seeded desk |
| **Price board** `/prices` | 8 instruments (EURUSD, GBPUSD, USDJPY, UST 10Y, Bund 10Y, IG CDS 5Y, Brent, Gold) ticking bid/ask with timestamps; "Simulate outage" makes a feed STALE | Prices tick, bid < ask, stale feed stops ticking, recovers |
| **Order ticket (RFQ)** `/trades` | Instrument, side, qty, price, client, counterparty, venue; live market panel with tolerance band; confirmation with trade ID and ClOrdID | Required fields, qty/price > 0, price inside the band, stale price blocked, double click = one trade |
| **Trade detail** `/trades/:id` | Lifecycle NEW → CONFIRMED → SETTLED / FAILED / CANCELLED, amend (NEW only), audit trail, FIX messages | Legal transitions work, illegal ones return 409 and change nothing, audit is complete |
| **Blotter** `/blotter` | Filters by asset class and status; cancelled trades hidden unless asked for | UI == API per filter |
| **FIX message log** `/fix` | Simulated FIX 4.4: 35=D NewOrderSingle, 35=8 ExecutionReport (150/39), 35=G amend, 35=F cancel; parsed tag table | Tags 11/55/54/38/44 equal the ticket; BodyLength(9) and CheckSum(10) are valid |
| **Data checks (SQL)** `/data-checks` | Read-only SQL console with preset break checks | Each seeded break is found; writes are rejected |
| Gig platform (prior work) | Jobs board, shifts with gross pay, 10-applicant batch, payouts | Kept from earlier work, still tested |

Demo login: `demo.user@example.com` / `Demo#Pass123`.

## Run it

Requires **Node 22 or newer** (better-sqlite3 13).

```bash
npm ci
npx playwright install --with-deps chromium
npx playwright test          # 83 tests, starts the app itself
npx playwright show-report   # HTML report
npm start                    # run the app yourself at http://localhost:3100
```

Optional: copy `.env.example` to `.env` (or export the variables) to override `BASE_URL`, `PORT`, `DEMO_USER`, `DEMO_PASSWORD`.

## Why this matters to a broker

Each test maps to a real desk risk:

| Risk | What goes wrong in production | How it's caught here |
|---|---|---|
| **Duplicate trade** | A double click or a network retry books the same trade twice. Both legs settle and real money moves twice. | UI double-click test, API `Idempotency-Key` tests, and the SQL duplicate-booking check (`GROUP BY ... HAVING COUNT(*) > 1`) that finds T-1002 / T-1008 |
| **Stale price** | A feed silently stops and the desk quotes off a price that's minutes old. | Price board stale test; the ticket and API refuse to validate an order on a stale quote (`STALE_PRICE`) |
| **Fat-finger price** | A broker types 92.10 instead of 82.40. | Tolerance band on the ticket and the API (`PRICE_TOLERANCE`), on amend too; SQL check against reference prices finds T-1009 |
| **Settlement fail** | A confirmed trade never settles or fails, and nobody chases it. | Lifecycle tests (fail → re-settle); SQL LEFT JOIN check finds trades with no settlement or a failed one |
| **FIX / booking mismatch** | The execution report a counterparty receives disagrees with the booking. | UI and API tests compare FIX tags with the order; SQL check finds a qty mismatch (T-1003) and a missing exec report (T-1006) |
| **Illegal state change** | A cancelled trade gets settled, or a settled trade gets cancelled. | Lifecycle API tests: every illegal transition returns 409 and leaves status and audit unchanged |
| **Blotter doesn't match the books** | Ops sees a different total from the database. | Blotter row-by-row == DB; reconciliation by status explains the hidden cancelled trade |
| **Bad maths** | Notional rounding drifts by a cent at scale. | Notional tests with tricky decimals (0.1×0.2, 1.005×1000, 99.875×3) |

## 2-minute interview demo script

Have the app open and logged in before the call.

1. **(15s) Overview.** "This is a practice project I use to sharpen my QA skills on trade flows. It's a mock broking desk: rates, FX, credit and commodities, voice and electronic. The tests and data checks are what I want to show you."
2. **(20s) Price board.** "Prices tick every second. If a feed stops" (click *Simulate outage* on Brent) "it goes STALE, and the ticket won't accept an order priced off it. There's a test for that."
3. **(30s) Order ticket.** Click EURUSD, type a quantity, click *Ask*, pick client and counterparty, then **double-click** *Submit order*. "One trade, not two. The button locks and the server dedupes on an idempotency key." Then type a silly price like 1.20 and submit: "Outside the tolerance band. That's the fat-finger guard."
4. **(20s) FIX log.** Click *FIX messages →* on the confirmation, then the 35=D row. "Every order sends a NewOrderSingle and an ExecutionReport. My test checks that ClOrdID, symbol, side, quantity and price in the FIX message match what I typed."
5. **(15s) Lifecycle.** Open the trade, click *Confirm* then *Settle*. "Each step is in the audit trail, and illegal moves, like settling before confirming, are blocked and tested."
6. **(20s) Data checks.** Click *Settlement breaks*: "LEFT JOIN, so trades with no settlement show as NULL." Then *Duplicate bookings*: "GROUP BY the trade's economics, HAVING COUNT > 1." Then type `DELETE FROM trades` and run it: "Read-only."
7. **(Close)** "All of it runs in CI on every push: 83 Playwright tests, UI and API. Happy to walk through any of the code."

If they ask who built the app: "I used AI tools to scaffold the app so I could focus on the testing."

## Test map (83 tests)

| File | What it checks |
|---|---|
| `tests/ui/price-board.spec.ts` | Ticks + bid < ask; outage → STALE, stops ticking, recovers; ticket blocks a stale instrument |
| `tests/ui/order-ticket.spec.ts` | Valid order == API + confirmation; missing client / counterparty; tolerance reject + reject KPI; Ask button fills price; double click = one trade and one 35=D |
| `tests/ui/trades.spec.ts` | Price/qty validation (6 cases); rapid double click; blotter row == API (notional 2 dp); buy/sell filter |
| `tests/ui/lifecycle.spec.ts` | NEW → CONFIRMED → SETTLED with audit; fail → re-settle; amend (35=G, new ClOrdID); cancel hides from blotter |
| `tests/ui/fix-log.spec.ts` | 35=D tags 11/55/54/38/44/56 == ticket; 35=8 New; confirm sends a fill 150=F 39=2 |
| `tests/ui/blotter.spec.ts` | Asset class filter == API; status filter counts; overview KPIs |
| `tests/ui/data-checks.spec.ts` | Blotter == DB; reconciliation; settlement breaks; duplicate bookings; INNER vs LEFT; FIX vs trades; tolerance; gig duplicate payout; new trade in DB; SELECT-only |
| `tests/api/orders.api.spec.ts` | Prices shape; tolerance in/out; stale blocks then recovers; RFQ field validation (5); idempotency |
| `tests/api/lifecycle.api.spec.ts` | Allowed transitions + audit; 5 illegal transitions → 409; amend outside tolerance; 404 |
| `tests/api/fix.api.spec.ts` | 35=D + 35=8 tags, MsgSeqNum, BodyLength and CheckSum recomputed; cancel 35=F + 150=4 |
| `tests/api/trades.api.spec.ts` | Validation, notional decimals, idempotency, side filter |
| `tests/api/sql.api.spec.ts` | SQL needs a session; booked trade persisted |
| `tests/ui/{auth,jobs,shifts,payouts}.spec.ts`, `tests/api/payouts.api.spec.ts` | Gig platform (prior work): login/logout, apply + duplicate, 10-applicant batch, slow network, shift gross, double-payout check, idempotent payouts |

## SQL data checks

The demo DB is seeded with deliberate breaks (`POST /api/reset?seed=demo`; tests start from an empty DB). The same queries are in `sql/data-checks.sql`.

| Ticket | Break | Technique |
|---|---|---|
| BRK-318 | T-1004 and T-1006 confirmed with no settlement, T-1005 FAILED | LEFT JOIN + `IS NULL` |
| BRK-322 | T-1008 duplicates T-1002 | `GROUP BY` economics `HAVING COUNT(*) > 1` |
| BRK-327 | Cancelled T-1007 in DB, not on blotter | totals by status reconcile to DB total |
| BRK-411 | T-1003 fill says qty 3 (trade 30); T-1006 has no exec report | LEFT JOIN `fix_messages` on 35=8/150=F |
| BRK-415 | Brent T-1009 booked 11.77% above reference | JOIN `instruments`, compare with `tolerance_pct` |
| BRK-420 | Rejects by reason | `GROUP BY reason` |
| GIG-322 | Gig payout paid twice (prior work) | `GROUP BY ... HAVING` |

The console only runs one `SELECT`/`WITH` statement and relies on SQLite's own `readonly` flag, so `DELETE`, `UPDATE`, `DROP`, `PRAGMA` and stacked statements are rejected.

## Project layout

- `app/server.js`: API, simulated market data, FIX builder, lifecycle rules, SQLite schema and seed, HTML pages. `app/public/*.js`: page scripts. `app/public/styles.css`: design.
- `pages/`: page objects (`TradesPage`, `PriceBoardPage`, `TradeDetailPage`, `FixLogPage`, `BlotterPage`, `DataChecksPage`, plus the gig pages).
- `fixtures/test.ts`: `api` (resets the DB), `loggedIn`, and the page objects.
- `sql/`: preset queries. `k6/`: load test. `scripts/`: demo video and screenshots.

## CI

`.github/workflows/playwright.yml` runs on every push and PR with Node 22: `npm ci`, install Chromium, run the suite, upload the HTML report.

## Demo media

```bash
MEDIA_DIR=../demo-media npx playwright test -c scripts/broker-demo.config.ts   # slow-mo walkthrough video + broker-*.png
```

## Load test (K6)

```bash
npm start
k6 run -e PROFILE=smoke k6/load-trades.js
```

New to the code? Read [HOW-IT-WORKS.md](HOW-IT-WORKS.md).
