# Proposal: mobile-dashboard-filtered-queries

## Why

The mobile dashboard loads the user's entire transaction history
(`useTransactions()` with no filters) into the TanStack Query cache and slices
month/category views with client-side selectors. On the local SQLite repository
this is invisible, but the web app is about to adopt the mobile dashboard's
UI/UX and would copy the same pattern onto HTTP — fetching the full history on
every dashboard open. Moving the dashboard to the repository's filtered queries
now fixes the pattern before it spreads, and pins down the timezone semantics
of "selected month" as a product decision before the two platforms diverge.

## What Changes

- **Product decision: "selected month" is the device's local calendar month.**
  Today this is the de-facto behavior of the `transactionsInMonth` selector but
  is defined nowhere. The mobile-local-data spec's home-screen requirement
  gains this definition plus a month-boundary scenario (a transaction at 00:30
  local on the 1st belongs to the new month). The spec stays product-level:
  how the month slice is computed (repository filter vs in-memory selector) is
  not spec material.
- **Month-bounded dashboard query.** The dashboard's main transactions query
  becomes filtered by an inclusive UTC day range covering the selected local
  month (a superset), instead of the full history. Child components
  (summary card, all-expenses card, category section) keep their props; the
  existing month selectors trim whatever superset they receive.
- **Category sheet fetches its own filtered data.** The category expenses
  sheet has an in-sheet month navigator, so it can no longer ride on the
  dashboard's month-bounded list: it issues its own query filtered by
  `type: expense`, `categoryId`, and the sheet's current month range (enabled
  only while a category is selected), trimmed by the existing selectors for
  exact local-month semantics. Sheet UI is unchanged — data plumbing only.
- **Conditional query support in the transactions hook.** `useTransactions`
  gains an optional second parameter `{ enabled }` for conditional queries.
  Cache invalidation is unchanged: the key is already parameterized by the
  filter options and mutations invalidate the `['transactions']` prefix.
- **Shared helper `monthToUtcDayRange(cursor)`.** Lives in the
  `@trata/dates` package (where `MonthCursor` and
  `transactionsInMonth` already live after the dates migration); maps a local
  calendar month to inclusive UTC days `fromDate`/`toDate` accepted by
  `TransactionQuery`. Web will reuse it when it adopts the dashboard pattern.

No user-visible behavior changes. Existing dashboard tests and maestro flows
must pass without edits; the helper gets new unit tests at month boundaries.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mobile-local-data`: the "Home screen data behavior" requirement gains the
  product definition of the selected month (device-local calendar month) and a
  month-boundary scenario.

## Impact

- **Mobile (`apps/mobile`)**: `pages/dashboard` (dashboard screen, category
  expenses sheet data wiring), `entities/transaction/model/use-transactions.ts`
  (optional `enabled` parameter). New unit tests for the helper; the mock
  transaction repository already honors all filters, so existing tests
  exercise the filtered path unchanged.
- **Shared package (`packages/dates`)**: new exported `monthToUtcDayRange`
  helper in `src/month.ts`. No other package changes.
- **Out of scope**: backend, OpenAPI contract, `packages/api` (the
  `categoryId`/`fromDate`/`toDate` filters already exist in the contract and
  both repository implementations — HTTP and SQLite), the web app, the
  transactions screen (same full-load pattern, deliberately untouched here),
  and any sheet UI redesign.
