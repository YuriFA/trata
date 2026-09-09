## 1. Shared helper `monthToUtcDayRange` (packages/dates)

- [x] 1.1 Add `monthToUtcDayRange(cursor: MonthCursor): { fromDate: string; toDate: string }` to `packages/dates/src/month.ts` per design D2 (local month instants → inclusive UTC days via `toISOString().slice(0, 10)`), export it from `packages/dates/src/index.ts`. No `@trata/api` import (design D1).
- [x] 1.2 Add `apps/mobile/src/shared/lib/month-to-utc-day-range.test.ts`: per-zone child Node processes with target `TZ` running the real helper (Jest cannot change its own zone — see design D6); cases for UTC, UTC+3 (`Europe/Moscow`), UTC−5 (`America/New_York`), a 31-day month, and December→January wraparound; assert the returned range is a superset of `transactionsInMonth` membership at boundary instants (00:30 local on the 1st, 23:30 local on the last day).
- [x] 1.3 Verify: `pnpm --filter @trata/dates type-check` and the new mobile test pass.

## 2. Hook: conditional queries (entities/transaction)

- [x] 2.1 In `apps/mobile/src/entities/transaction/model/use-transactions.ts`, add the optional second parameter `{ enabled?: boolean }` to `useTransactions` and pass it to `useQuery` (default `true`). Query key and mutation invalidation unchanged (design D5).
- [x] 2.2 Confirm existing hook tests (`entities/transaction/api/use-transactions.test.tsx`) pass without edits.

## 3. Dashboard: month-bounded main query

- [x] 3.1 In `apps/mobile/src/pages/dashboard/ui/dashboard-screen.tsx`, replace `useTransactions()` with `useTransactions(monthToUtcDayRange(cursor))`. Child props (`SummaryCard`, `AllExpensesCard`, `CategorySection`) stay as-is (design D3).
- [x] 3.2 Run `apps/mobile` jest — the dashboard suite (`dashboard-screen.test.tsx`) must pass unedited; the mock repository already applies the filters.

## 4. Category sheet: own filtered query

- [x] 4.1 In `apps/mobile/src/pages/dashboard/ui/category-expenses-sheet.tsx`, add `useTransactions({ type: 'expense', categoryId: category?.id, ...monthToUtcDayRange(cursor) }, { enabled: category !== undefined })` keyed to the sheet's own cursor (design D4); use `query.data ?? []` instead of the `transactions` prop; wrap the derivation (`expenseDayGroups`, `totalExpenses`) in `useMemo`.
- [x] 4.2 Remove the now-unused `transactions` prop from `CategoryExpensesSheetProps` and from the call site in `category-section.tsx` (UI untouched). Update the file-top comment that describes client-side-only aggregation.
- [x] 4.3 Re-run the dashboard suite; the "opens a category-filtered expense sheet" test must still pass unedited.

## 5. Verification

- [x] 5.1 Full checks: `pnpm --filter mobile type-check`, `pnpm --filter mobile test`, root `pnpm knip` (new dates export is used by mobile; no dangling files/exports).
- [x] 5.2 Maestro dashboard flow (`apps/mobile/.maestro/flows`) passes unchanged — no UI/testID edits anywhere in this change. (Verified on a real iOS dev build + SQLite: 01-dashboard, 05/06/07 data setup, and 08-home pass; 10-category-expenses passes every data-dependent step — sheet rows from its own filtered query, in-sheet month navigation, sort, footer, edit — and fails only on its final `category-expenses-close` tap, a testID absent from src entirely and lost in the earlier sheet redesign, i.e. a pre-existing failure unrelated to this change.)
- [x] 5.3 Confirm scope holds: no diffs under `backend/`, `docs/api/`, `packages/api/`, `apps/web/`, and no UI changes in `expenses-sheet.tsx` / `category-expenses-sheet.tsx` beyond data plumbing.
