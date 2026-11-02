# brokerdesk-playwright-tests

![tests](https://github.com/Kismet-Git-Portfolio/brokerdesk-playwright-tests/actions/workflows/playwright.yml/badge.svg)

Playwright + TypeScript tests I wrote against a small mock trading desk (BrokerDesk). All data is fake. It isn't based on any real firm's system.

I built this to practise QA on trade flows. Most of the tests come from bugs I've seen at work: double payouts, flows breaking on slow networks, and double clicks booking things twice. Here they're applied to trades: duplicate bookings, stale prices, fat-finger prices, trades that never settle, and FIX messages that don't match the booking.

App scaffolding built with AI help; test design and data checks are mine.

## Running it

Needs Node 22+.

```
npm ci
npx playwright install --with-deps chromium
npx playwright test        # starts the app itself, 91 tests
npx playwright show-report
npm start                  # app on http://localhost:3100
```

Login: `demo.user@example.com` / `Demo#Pass123`

## What's tested

- Price board: prices tick, bid < ask, a frozen feed goes stale and the ticket won't take an order on it
- Order ticket: required fields, qty/price > 0, price must be inside a tolerance band, double click books one trade
- Trade lifecycle: NEW > CONFIRMED > SETTLED/FAILED/CANCELLED, illegal moves return 409 and change nothing, audit trail
- FIX log: tags in the NewOrderSingle and ExecutionReport match the ticket, BodyLength and CheckSum are recomputed
- Blotter: filters match the API, cancelled trades hidden by default
- SQL data checks (`sql/data-checks.sql`): missing/failed settlements (LEFT JOIN), duplicate bookings (GROUP BY ... HAVING), blotter vs DB reconciliation, FIX vs trades, prices outside tolerance. The SQL page is read-only.
- Older gig-platform flows from my previous project (jobs, shifts, payouts)

- API status codes: one test each for 201, 204, 400, 401, 403, 404, 422 and 500. I check the body too, not just the code. Table in API_STATUS_CODES.md

UI tests are in `tests/ui`, API tests in `tests/api`, page objects in `pages/`. CI runs everything on each push.

See DEMO.md for the short walkthrough I use and NOTES.md for how the app works.
