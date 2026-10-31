# Playwright + TypeScript QA Demo

![Playwright Tests](https://github.com/<your-username>/<repo-name>/actions/workflows/playwright.yml/badge.svg)
<!-- Replace <your-username>/<repo-name> after pushing to GitHub -->

A self-contained QA automation demo. It ships a tiny mock web app (Node + Express, in-memory data) with:

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

## Test map (34 tests)

| File | What it checks |
|---|---|
| `tests/ui/auth.spec.ts` | Valid login, invalid password error, logout ends the session and protected pages redirect |
| `tests/ui/shifts.spec.ts` | Shift form shows the correct gross total, backend gross matches, it appears in the listing; negative pay rejected |
| `tests/ui/jobs.spec.ts` | Job listing; apply to a job and duplicate apply blocked; **batch: 10 applicants created via API, all 10 verified in the UI**; **slow network** (`page.route` delay) shows the loading state |
| `tests/ui/payouts.spec.ts` | **Double-payout check:** UI amount == API amount == expected sum (and not 2×) |
| `tests/ui/trades.spec.ts` | Validation for negative, zero and non-numeric price/qty; rapid double click books exactly one trade; blotter row == API values; buy/sell filter |
| `tests/api/payouts.api.spec.ts` | Payout = sum of components (decimal-safe), invalid input rejected, same Idempotency-Key pays once |
| `tests/api/trades.api.spec.ts` | Validation, notional math with decimal precision, idempotency, side filter |

## CI

`.github/workflows/playwright.yml` runs on every push and pull request: install deps, install Chromium, run the suite, and upload `playwright-report/` as a build artifact (download it from the run's Summary page).

## Load test (K6)

`k6/load-trades.js` posts trades and reads the blotter, with thresholds **p95 < 500 ms** and **errors < 1%**. It isn't part of CI.

```bash
npm start                                   # terminal 1
k6 run -e PROFILE=smoke k6/load-trades.js   # 1 user for 30s
k6 run k6/load-trades.js                    # ramp to 20 users
```

New to the code? Read [HOW-IT-WORKS.md](HOW-IT-WORKS.md).
