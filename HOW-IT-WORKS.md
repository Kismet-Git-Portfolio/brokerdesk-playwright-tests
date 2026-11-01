# How it works (beginner walkthrough)

## 1. Folder map

```
app/server.js              The mock web app (Express). JSON APIs on top, UI pages below, data kept in memory.
app/public/styles.css      The ShiftDesk design system (navy/teal, cards, badges, skeletons, toasts).
playwright.media.config.ts Records slowed-down videos of the key UI tests.
scripts/                   Screenshot script for demo media.
playwright.config.ts       Playwright settings: where tests live, base URL, reporters, webServer.
pages/                     Page objects: one class per screen (LoginPage, JobsPage, ShiftPage,
                           JobDetailPage, PayoutsPage, TradesPage).
fixtures/test.ts           Custom fixtures: `api`, `loggedIn`, and the page objects.
fixtures/env.ts            Reads credentials from env vars (with demo defaults).
fixtures/data.ts           Random, unique test data helpers.
tests/ui/                  Browser tests (they click and type like a user).
tests/api/                 API tests (they call the JSON endpoints directly, no browser).
k6/load-trades.js          K6 load script (run by hand, not in CI).
.github/workflows/         GitHub Actions CI.
.env.example               Example environment variables.
```

## 2. How the app starts by itself

`playwright.config.ts` has a `webServer` block. Before any test runs, Playwright runs `node app/server.js`, then polls `http://localhost:3100/health` until it answers. When the tests finish it stops the server. Locally, if the app is already running (`npm start`), it reuses it (`reuseExistingServer`); in CI it always starts a fresh one.

Because data lives in memory, the config uses `workers: 1`, and the `api` fixture calls `POST /api/reset` before each test so every test starts clean.

Pages: `/` QA Showcase home (coverage table), `/jobs`, `/jobs/:id`, `/shifts/new`, `/payouts`, `/payouts/:id` (PDF-style statement), `/trades`. The buy/sell toggle and filter chips stay in sync with the plain `<select>` elements the tests use, so UI polish never changes test behaviour.

## 3. Page objects

A page object hides the "how" (locators) behind readable methods. For example `TradesPage.fill({...})` fills four fields, so the test just says what it wants:

```ts
await tradesPage.fill({ instrument: 'EURUSD', side: 'buy', price: '1.08', quantity: '100' });
await tradesPage.submit().click();
```

If a field changes, you fix it in one place. Locators use `getByTestId(...)`, which reads the `data-testid` attribute (set in the config with `testIdAttribute`). Test IDs don't break when styling or text changes, unlike CSS classes or `nth()`.

## 4. Fixtures

Fixtures are things a test asks for by name in its arguments. In `fixtures/test.ts`:

- `api`: Playwright's request client. Before handing it over, it resets the store.
- `loggedIn`: depends on `api` and `loginPage`; it signs in through the UI and checks we landed on `/jobs`.
- `loginPage`, `tradesPage`, etc.: ready-made page objects.

So `test('x', async ({ loggedIn, tradesPage }) => ...)` means: reset data, log in, give me the trades page object.

## 5. Env vars

`fixtures/env.ts` reads `DEMO_USER` and `DEMO_PASSWORD`, and the server reads the same ones, so they always match. Defaults are fake demo values. In a real project you would put real secrets in CI secrets, never in code. `BASE_URL` and `PORT` change where the app runs.

## 6. How each test works

- **auth**: logs in with good credentials (lands on Jobs), bad password (error text, stays on /login), logout (back to /login, and /jobs now redirects).
- **shifts**: types base 750 + allowance 120.50 + special 49.25, checks the on-screen gross says 919.75, publishes, checks the toast, then asks the API and checks it saved 919.75 too, then finds that row in the listing. A second test checks negative pay is rejected.
- **jobs listing**: the two seeded jobs are shown.
- **job application**: opens a job, applies, sees "Application sent!" and count 1; applying again with the same email shows "Already applied".
- **batch of 10**: creates 10 applicants through the API (fast setup, no clicking), then opens the job page and checks all 10 emails are visible. This is the "10 applicants in one run" time-saver.
- **slow network**: `page.route('**/api/jobs', ...)` waits 2 s before letting the request through. The test checks the "Loading..." text shows and the table is hidden, then waits (auto-waiting, no `waitForTimeout`) for the rows.
- **payouts (double-payout check)**: creates a payout of 1500 + 250.75 + 99.99 through the API, checks the API amount is exactly 1850.74 (and not double), then checks the Payouts page shows "1850.74". Three sources must agree: expected, API, UI.
- **trades UI**: six validation cases (negative, zero, text for price and for quantity) each show an error and create nothing; a `dblclick()` on Book creates exactly one trade (the button disables itself and the server also dedupes by Idempotency-Key); a booked trade's blotter row matches the API's values, including notional 99.875 × 3 = 299.63; the filter shows only sells, then only buys.
- **API tests**: same rules without a browser: validation returns 400, notional math with tricky decimals (0.1 × 0.2 = 0.02, 1.005 × 1000 = 1005), two parallel requests with the same Idempotency-Key create one record, and `?side=sell` filters.

## 7. How CI works

`.github/workflows/playwright.yml` runs on every push and pull request. On a fresh Ubuntu machine it checks out the code, installs Node 20, runs `npm ci`, installs Chromium, runs `npx playwright test` (the webServer starts the app), and uploads `playwright-report/` as an artifact, even when tests fail. With `CI` set, the config retries a failing test once and records a trace on that retry, so you can see exactly what happened.

## 8. Try this (tinkering exercises)

1. **Break the math on purpose.** In `app/server.js`, change payout `amount` to `round2((base + allowance + special) * 2)`. Run `npx playwright test payouts` and watch the double-payout test catch it. Undo the change.
2. **Remove the double-click guard.** In the `/trades` page script, delete `if(btn.disabled)return;btn.disabled=true;` and the Idempotency-Key header. Does the double-click test fail? Put it back.
3. **Make the network slower.** Change the 2000 ms delay in the slow-network test to 8000 and see it still pass with no extra sleeps. Then try 15000 and read the timeout error.
4. **Add a validation rule.** Make the server reject quantities above 1,000,000, then add a UI test and an API test for it.
5. **Debug visually.** Run `npx playwright test --ui` or `npx playwright test --headed --debug tests/ui/trades.spec.ts`, step through a test, and open a trace from the HTML report.

## 9. SQL data checks

- `app/server.js` creates an in-memory SQLite DB on start (`reset()` → `SCHEMA` → `seedDemo()`). `/api/trades` and `/api/payouts` read from and write to it, so the UI, API and DB always share one source of truth.
- `POST /api/sql` is the read-only runner (`runReadOnly`). It rejects anything that isn't a single `SELECT`/`WITH` statement, and it relies on better-sqlite3's `stmt.readonly` flag instead of a fragile keyword list.
- `sql/presets.js` holds the queries behind the preset buttons. `sql/data-checks.sql` has the same queries with comments telling each ticket story.
- `pages/DataChecksPage.ts` is the page object. `table()` returns the result grid as arrays, so tests can do `expect(rows).toEqual([...])`.
- Try this: in the console, run `SELECT * FROM settlements WHERE status = NULL` and then `... IS NULL`. The first returns 0 rows because NULL never equals anything.
- Media: `npx playwright test -c scripts/sql-demo.config.ts` records the slow-mo walkthrough (set `MEDIA_DIR` for the screenshots).
