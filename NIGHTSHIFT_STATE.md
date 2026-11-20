# NightShift progress

## Objective
Polish CharMsg UX, stability, performance and security, and deliver an administrator-controlled paper-trading system using verified public market data.

## Scope and safeguards
- Base commit fc365dc. Worktree was clean before work.
- Work branch nightshift-polish-bots-20261120.
- Local changes and local commits only. No push, publication, production migrations or deployment.
- Keep Firebase Authentication, Neon storage and existing four-section navigation.
- The earlier casino replacement remains deferred under the user's explicit instruction.
- NightShift skill is not listed or found in the installed skill paths inspected.
- Apply Ponytail. Security review is source-first and focused on application trust boundaries.
- Trading uses isolated virtual USD balances. No exchange credentials or real order API.

## Initial audit observations
- Static ES modules, Express callable API, Firebase Authentication, Neon PostgreSQL document adapter.
- Existing CHR bots are a client-triggered synthetic game-market mechanism. They are not independent portfolios or externally sourced paper trading.
- New paper trading must be separate from users' CR, NFTs and the existing CHR price generator.
- Production uses Render Free. A continuously running worker cannot be guaranteed while the web service is suspended. Dedicated worker process must be supported and documented.
- NFT subscriptions refresh entire lists, client requests include explicit mutation invalidation, and the UI already has pending-operation states.
- Existing four-section navigation remains intact; the bot console is a secondary admin route.
- Found stale Firestore/auth explanations, non-atomic admin CR grants, overly broad generic admin profile updates and database error leakage.

## Work plan
1. Completed bounded source/security/UX audit and verified Coinbase Exchange public API behavior.
2. Completed deterministic trading, risk/accounting engine and rate-limited public data adapter.
3. Completed private PostgreSQL tables for bot state, idempotent orders, decisions, equity and global stop.
4. Completed independent worker lifecycle and canonical-admin-only endpoints.
5. Completed admin editor, copy/start/pause/archive controls, monitoring, filters and status/error states.
6. Completed prioritized fixes: atomic CR grants, profile mutation whitelist, safe database errors and current admin copy.
7. Full API integration rerun passed after fixing repeat-fixture collisions. NFT release suite is being checked separately.
8. Report written; local checkpoint pending. Mission remains incomplete: historical backtests, operation drill-down, history UI pagination, fuller portfolio metrics, real process restart and whole-product visual review remain.

## Current verification
Passing checks: build; navigation; refresh invalidation; notifications; paper engine and 12 deterministic scenarios; market adapter failure/retry cases; live BTC-USD public quote; PostgreSQL database adapter; paper persistence with two bots; trading/offer suite; Playwright 390px and 1440px layouts.
The scenario results include gains and losses after costs. No profitability claim is made.
Production schema, worker and site remain unchanged by design.

## Next step
Check release suite output, commit the verified local checkpoint, then finish the explicitly listed missing capabilities and review the worker concurrency/status edge cases before treating the mission as complete.
