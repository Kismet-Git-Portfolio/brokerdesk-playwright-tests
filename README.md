# Playwright + TypeScript QA Demo

![Playwright Tests](https://github.com/<your-username>/<repo-name>/actions/workflows/playwright.yml/badge.svg)
<!-- Replace <your-username>/<repo-name> after pushing to GitHub -->

**ShiftDesk QA Showcase**: a self-contained QA automation demo. It ships a polished mock web app (Node + Express, in-memory data, plain HTML/CSS/vanilla JS with no build step) with a QA Showcase home page, a Gig Platform area and a Trading Desk:

- **Gig shifts:** login/logout, job and shift listing, shift creation with compensation (base + allowance + special = gross), job applications, payouts.
- **Finance module:** trade booking (instrument, side, price, quantity), notional = price × quantity rounded to 2 decimals, a blotter with a buy/sell filter, and idempotent submits.

Playwright starts the app automatically, so there is nothing else to set up. All data and credentials are fake demo values.

## Run it

```bash
npm ci
npx playwright install --with-deps chromium
npx playwright test          # all tests (starts the app itself)
npx playwright show-report   # open the HTML report
npm start                    # optional: run the app yourself at http://localhost:3100
```

Optional: copy `.env.example` to `.env` (or export the variables) to override `BASE_URL`, `PORT`, `DEMO_USER`, `DEMO_PASSWORD`.

## What's inside

- **Page objects** (`pages/`): one class per screen, with locators by `data-testid`.
- **Fixtures** (`fixtures/test.ts`): `api` resets the in-memory store before each test, `loggedIn` signs in through the UI, and each page object is injected.
- **Test data** (`fixtures/data.ts`): unique random names and emails for every run.
- **No hard waits:** everything uses Playwright's auto-waiting and web-first assertions.

## Test map (42 tests)

| File | What it checks |
|---|---|
| `tests/ui/auth.spec.ts` | Valid login, invalid password error, logout ends the session and protected pages redirect |
| `tests/ui/shifts.spec.ts` | Shift form shows the correct gross total, backend gross matches, it appears in the listing; negative pay rejected |
| `tests/ui/jobs.spec.ts` | Job listing; apply to a job and duplicate apply blocked; **batch: 10 applicants created via API, all 10 verified in the UI**; **slow network** (`page.route` delay) shows the loading state |
| `tests/ui/payouts.spec.ts` | **Double-payout check:** UI amount == API amount == expected sum (and not 2×) |
| `tests/ui/trades.spec.ts` | Validation for negative, zero and non-numeric price/qty; rapid double click books exactly one trade; blotter row == API values; buy/sell filter |
| `tests/api/payouts.api.spec.ts` | Payout = sum of components (decimal-safe), invalid input rejected, same Idempotency-Key pays once |
| `tests/api/trades.api.spec.ts` | Validation, notional math with decimal precision, idempotency, side filter |

## SQL data checks

Trades, settlements and payouts are stored in an in-memory **SQLite** DB (`better-sqlite3`). The app starts with demo data that has deliberate defects; tests reset to an empty DB (`POST /api/reset`) or reseed it (`POST /api/reset?seed=demo`).

- **Data checks page:** `http://localhost:3100/data-checks`. Preset buttons run the ticket queries, and the editor runs your own query and shows the results in a table. It's **read-only**: one statement, `SELECT`/`WITH` only, checked with SQLite's own `readonly` flag. `DELETE`, `UPDATE`, `DROP`, `PRAGMA` and stacked statements are rejected.
- **Queries with ticket stories:** `sql/data-checks.sql`

| Ticket | Defect seeded | Query |
|---|---|---|
| QA-318 | T-1004 and T-1006 have no settlement, T-1005 FAILED | LEFT JOIN + `IS NULL` |
| QA-322 | Ben Cruz / shift-B7 paid twice | `GROUP BY ... HAVING COUNT(*) > 1` |
| QA-318 | INNER vs LEFT JOIN row counts differ by 2 | `UNION ALL` of both counts |
| QA-327 | Cancelled trade T-1007 is in the DB but not on the blotter | reconcile `SUM(notional)` by status |

Tests: `tests/ui/data-checks.spec.ts` (blotter == DB row by row, totals reconcile, seeded defects found, non-SELECT rejected) and `tests/api/sql.api.spec.ts` (auth required, an API-booked trade lands in the DB).

### 2-minute interview demo script

1. **(15s) Set up:** "UI tests prove the screen is right. I also check the data behind it. This app runs on SQLite, seeded with the kind of defects I'd hunt for."
2. **(25s) Trade booking:** show the blotter. "Six live trades. Is that everything in the database?"
3. **(30s) Data checks → QA-318:** click *Missing / failed settlements*. "LEFT JOIN keeps every trade, so the two that never settled show up as NULL, plus one FAILED. An INNER JOIN would hide them." Click *INNER vs LEFT JOIN* to show the gap of 2.
4. **(20s) QA-322:** click *Duplicate payouts*. "I group by the business key, worker plus shift, and HAVING COUNT > 1 finds the one paid twice."
5. **(20s) QA-327:** click *Blotter total reconciliation*. "The DB has 7 trades but the blotter shows 6. The gap is a CANCELLED trade. I'd confirm with the BA that hiding it is expected."
6. **(10s) Safety:** type `DELETE FROM trades` and run it. "It's rejected. The console is read-only, and there's a Playwright test for that."
7. **(Close)** "All of this is automated: `npx playwright test`, 42 tests, including the blotter matching the DB row by row."

## CI

`.github/workflows/playwright.yml` runs on every push and pull request: install deps, install Chromium, run the suite, and upload `playwright-report/` as a build artifact (download it from the run's Summary page).

## Load test (K6)

`k6/load-trades.js` posts trades and reads the blotter, with thresholds **p95 < 500 ms** and **errors < 1%**. It isn't part of CI.

```bash
npm start                                   # terminal 1
k6 run -e PROFILE=smoke k6/load-trades.js   # 1 user for 30s
k6 run k6/load-trades.js                    # ramp to 20 users
```

## Demo media

```bash
npx playwright test -c playwright.media.config.ts      # slowed (slowMo 400) videos of key UI tests -> media-results/
MEDIA_DIR=. npx playwright test -c scripts/screenshots.config.ts   # full-page screenshots
```

New to the code? Read [HOW-IT-WORKS.md](HOW-IT-WORKS.md).
