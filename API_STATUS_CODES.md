# API status codes in BrokerDesk

Each code has one test in `tests/api/status-codes.api.spec.ts`.

| Code | Meaning | BrokerDesk scenario | What the test checks |
|---|---|---|---|
| 201 | Created | `POST /api/orders` with a valid EURUSD order at the current mid | Status 201, new trade has an id and status NEW |
| 204 | Success, no content | `DELETE /api/drafts/:id` on a draft I just saved | Status 204 and the body is empty |
| 400 | Bad request | `POST /api/orders` with broken JSON (missing closing brace) | Status 400, error "Malformed JSON" |
| 401 | Not signed in | `POST /api/sql` with no session cookie | Status 401, error "Sign in required" |
| 403 | Signed in but not allowed | Log in as the demo trader, then `POST /api/admin/limits` | Status 403, error "Admin role required", role is trader |
| 404 | Not found | `GET /api/trades/T-DOESNOTEXIST` | Status 404, error "Trade not found" |
| 422 | Valid format, bad value | `POST /api/drafts` with quantity -100 | Status 422, code VALIDATION, quantity error message |
| 500 | Server error | `GET /api/test/fault`, a test-only route that throws on purpose | Status 500, error "Internal server error" |

The 500 route is fault injection for the demo only. In a real app any 500 is a bug I would log.
