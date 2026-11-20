# CharMsg NightShift report

## Audit findings

CharMsg is a static ES-module client backed by a callable Express/Firebase API and a Neon PostgreSQL document adapter. The four-section navigation and most empty/loading states were already coherent, so the work kept that structure. The existing CHR market bots were synthetic, ran only when a client ticked the game market and shared player-facing game state; they could not satisfy independent paper portfolios or external market-data requirements.

The audit also found stale Firestore and legacy admin-session explanations after the Neon migration, a read-then-write admin CR grant that could lose concurrent changes, unrestricted fields in the generic admin profile update, raw PostgreSQL error text reaching clients, and repeat integration fixtures with fixed NFT identifiers/names.

## Product and interface changes

The administrator now has a dedicated **Trading Bots** route linked from the existing admin page. It keeps CharMsg typography, cards, colours and controls, and adds:

- a clear Paper Trading explanation and no-profit-guarantee message;
- create, edit, copy, start, pause and archive actions;
- an explicit Emergency Stop with confirmation;
- worker heartbeat, provider-error and risk-stop states;
- totals for virtual equity, realized P/L, active bots and profitable closes;
- a real event-backed equity chart;
- filters for bot, pair, period, event type, side and result;
- readable decision reasons and an empty state explaining the next action;
- responsive cards, form and table behavior without horizontal page overflow at 390 px and 1440 px.

The misleading Firestore/password-hash/12-hour session copy in the administrator page was replaced with the actual Firebase Authentication and server-claim model. README setup and storage descriptions now match Firebase Authentication plus Neon PostgreSQL.

## Trading system

The system uses separate virtual USD balances and never reads or writes player CR, CHR or NFTs. Supported strategies are trend following, momentum and mean reversion for BTC-USD, ETH-USD and SOL-USD. Arbitrage was deliberately omitted because a single source cannot establish a valid cross-venue opportunity.

`CoinbaseMarket` calls only the fixed Coinbase Exchange public host and supported products. It serializes requests, shares a short cache, applies timeouts and bounded retries, rejects stale/malformed/incomplete data, and never substitutes generated prices. A live check received a one-second-old BTC-USD ticker with 40 closed one-minute candles.

The deterministic engine validates every configuration, calculates fills in integer cents, applies configurable fees and slippage, blocks a signal that cannot cover round-trip costs, and enforces cash, trade, position-count, position-size, daily-loss and drawdown limits. It stops new orders when prices are stale, a position lacks a fresh mark, volume is insufficient, spread is excessive or price movement is anomalous. Cash cannot become negative.

Private PostgreSQL tables store configuration, full portfolio state, status, scheduling, decisions, orders, equity snapshots and the global halt flag. Bot and control rows are locked in one transaction. Deterministic order keys plus a unique database constraint protect against duplicate execution after retries, multiple workers or restarts. Emergency Stop locks the same control row before pausing all running bots, so it prevents new committed orders rather than only changing the UI.

The worker is a separate process (`npm run paper:worker` in `functions`), batches current data for all due bots, commits each bot atomically, records provider failures and exits cleanly on SIGINT/SIGTERM. State is read from PostgreSQL on every cycle, so a process restart resumes from committed state.

## Security and correctness fixes

- Every paper endpoint requires the canonical server-side administrator identity; a profile flag cannot grant access.
- Paper tables have PostgreSQL RLS enabled and PUBLIC privileges revoked.
- Inputs, identifiers, numeric ranges, history filters and state transitions are validated server-side.
- Generic admin profile writes now allow exactly one validated `rank`, `verified` or `nickGradient` field.
- Admin CR grants now use a server transaction and bounded numeric input.
- PostgreSQL error codes are logged server-side and returned as a generic internal error.
- Market URLs cannot be supplied by an administrator or client, preventing arbitrary outbound requests.
- No exchange credentials, real order endpoint or real-money execution path exists.

## Verification and simulation results

Passing checks:

- `npm run build`: 54 JavaScript files and static entry points;
- paper engine unit checks: accounting, fees, slippage, stale/invalid prices, duplicate quote suppression, risk stop, independent portfolios and non-negative cash;
- 12 deterministic rising, falling, sideways and shock scenarios across three strategies;
- market adapter checks: fixed host/products, request coalescing, cache, incomplete candles, unavailable provider and bounded 429 retries;
- live Coinbase Exchange adapter check: BTC-USD ticker and 40 closed candles;
- isolated Neon paper test: two bots, one batched market fetch, one order per quote, state reread after a simulated restart, provider outage and Emergency Stop;
- database adapter checks: merge, queries, rollback, concurrency and access;
- offer/trading checks: escrow, duplicate requests, reservation safety, double acceptance, refunds, private history and logs;
- navigation, immediate refresh and notification suites;
- Playwright fixture at 390 × 844 and 1440 × 900: monitoring data, editor opening and no horizontal page overflow.

Scenario ending equity from 10,000 virtual USD, after configured fees and slippage:

| Strategy | Rising | Falling | Sideways | Shock |
|---|---:|---:|---:|---:|
| Trend | 10,055.54 | 10,000.00 | 9,975.14 | 9,944.90 |
| Momentum | 10,055.54 | 10,000.00 | 10,013.07 | 9,948.98 |
| Mean reversion | 10,000.00 | 9,928.88 | 10,010.19 | 10,004.47 |

These generated scenarios validate mechanics and show that costs can make strategies lose money. They are not historical backtests and do not demonstrate expected profitability.

## Remaining limitations and recommendations

- This is a substantial first implementation, not completion of every item in the mission. Historical provider-data backtests, detailed operation drill-down, UI pagination, unrealized-P/L/fee/average-return monitoring, whole-product visual review and a real worker-process restart test remain unfinished. The database test verifies state persistence through rereads, not an actual process restart. The graph shows only the current loaded event window and requires one bot to avoid mixing portfolios.
- The complete API integration suite passed after making test NFT numbers, series names, usernames and clans unique across runs.

- No production migration, worker, push or deployment was performed, as requested. `functions/paper/schema.sql` must be applied before the production UI can work.
- Render Free suspends the web service and does not guarantee a continuously running worker. Continuous simulation needs an always-on worker host; the admin heartbeat makes this visible.
- The public data adapter uses one venue. Add a second independently validated venue before considering arbitrage.
- A longer historical walk-forward backtest should use stored provider candles and separate train/evaluation periods before strategy tuning. The included scenarios are correctness fixtures only.
- Browser verification used a deterministic API fixture. Real-phone notification behavior and the deployed administrator session were outside this local-only run.

## Changed files

- `functions/paper/engine.js`, `market-data.js`, `service.js`, `worker.js`, `schema.sql`
- `functions/paper/engine.test.mjs`, `market-data.test.mjs`, `service.test.mjs`
- `functions/index.js`, `client-data.js`, `package.json`, `integration.test.mjs`
- `js/views/bots.js`, `js/views/admin.js`, `js/app.js`, `js/store.js`
- `css/paper.css`, `index.html`, `scripts/paper-ui.playwright.js`
- `README.md`, `package.json`, `NIGHTSHIFT_STATE.md`, `NIGHTSHIFT_REPORT.md`
