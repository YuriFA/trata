## Context

The dashboard screen (`apps/mobile/src/pages/dashboard/ui/dashboard-screen.tsx`)
calls `useTransactions()` with no filters, so the whole history lands in the
TanStack Query cache, and month/category views are JS selectors over it
(`pages/dashboard/model/selectors.ts`). The repository seam already supports
everything needed: `TransactionQuery` has `type`, `categoryId`, `fromDate`,
`toDate` (`CalendarDay` = `YYYY-MM-DD`), implemented identically by the SQLite
repository (`occurredAt >= fromDate` midnight UTC, `<= toDate` end of UTC day,
both inclusive), the HTTP repository, and the mobile mock repository used in
tests. `MonthCursor` and `transactionsInMonth` live in `@trata/dates`
(`packages/dates/src/month.ts`) after the dates-package migration. See
proposal.md for why this changes now.

Key constraint discovered during research: the category expenses sheet
(`pages/dashboard/ui/category-expenses-sheet.tsx`) has its own in-sheet month
navigator (own cursor, reset to `initialCursor` on every present). Once the
dashboard's main query is month-bounded, that sheet can no longer reuse the
dashboard's list — it must issue its own query for its own current month.
The all-expenses sheet has no in-sheet navigation and is unaffected.

## Goals / Non-Goals

**Goals:**

- Dashboard data flow uses repository-filtered queries; no component requests
  the unbounded history.
- Exact current user behavior preserved: identical rendered figures, props of
  `SummaryCard` / `AllExpensesCard` / `CategorySection` unchanged, existing
  tests and maestro flows pass without edits.
- The month-superset→trim pattern is written down precisely enough that web
  can copy it onto HTTP later.

**Non-Goals:**

- Any UI/UX change to the sheets (data plumbing only).
- Touching the transactions screen (`pages/transactions/`), which has the same
  full-load pattern — separate change if desired.
- Backend / OpenAPI / `packages/api` / web changes.
- Pagination (`listPage`) adoption — the SQLite `query()` with filters is
  bounded enough locally; HTTP pagination is web's problem when it copies the
  pattern.

## Decisions

### D1. Helper lives in `packages/dates`, not app-local

The original idea placed `monthToUtcDayRange` in a mobile
`shared/lib/calendar/month.ts`, but that path no longer exists — month-cursor
logic migrated to `packages/dates/src/month.ts`. The helper belongs beside
`MonthCursor`/`transactionsInMonth`: the dates package is the shared date
facade, web will need the identical mapping when it adopts the dashboard
pattern, and `packages/dates` is not on the change's exclusion list.

`packages/dates` must not import `@trata/api` (keeps the dependency
direction clean; `api` depends only on `money`), so the return type is plain
`{ fromDate: string; toDate: string }` — structurally assignable to
`Pick<TransactionQuery, 'fromDate' | 'toDate'>`.

### D2. `monthToUtcDayRange` returns an inclusive UTC-day *superset* of the local month

```
startLocal = new Date(cursor.year, cursor.month, 1)          // local midnight
endLocal   = new Date(cursor.year, cursor.month + 1, 1) - 1ms // last local ms
fromDate   = startLocal.toISOString().slice(0, 10)            // UTC day floor
toDate     = endLocal.toISOString().slice(0, 10)              // UTC day of end
```

`toISOString()` is environment-TZ-independent, so no date-fns UTC mode is
needed (plain `Date` API is allowed in packages). Examples: August 2026 in
UTC+3 → `2026-07-31..2026-08-31`; in UTC−5 → `2026-08-01..2026-09-01`; in UTC
→ `2026-08-01..2026-08-31`.

Superset, not exact: UTC day-range filters cannot express local-month
boundaries in non-UTC zones. Correctness therefore always comes from the
existing local-time selectors applied on top (`transactionsInMonth` and its
derivatives) — the SQL range is only a pre-filter that shrinks the working
set. Proof of containment: every transaction in the local month has
`occurredAt ∈ [startLocal, endLocal]`, hence `occurredAt >= fromDateT00:00Z`
and `occurredAt < (toDate+1)T00:00Z`, which the inclusive day filters admit.

Alternative rejected: exact boundaries via full UTC timestamps — would require
new repository filter semantics (`from`/`to` instants) and contract changes,
and would still not remove the need for the local-time selectors in the sheet
(month switching reuses cached supersets).

### D3. Dashboard main query is month-bounded; children unchanged

`dashboard-screen.tsx` calls `useTransactions(monthToUtcDayRange(cursor))`.
`SummaryCard`, `AllExpensesCard`, and `CategorySection` keep receiving
`(cursor, transactions, categories)`; every selector they use
(`totalExpenses`, `monthlyBalance`, `expenseDayGroups`, `categoryBreakdown`,
`latestExpense`) starts with `transactionsInMonth`, so they produce identical
output on any superset of the month. Prev/next month navigation changes the
query key, which refetches that month's range (TanStack caches each visited
month separately).

### D4. Category sheet owns its filtered query

Inside `CategoryExpensesSheet`:

```
const range = monthToUtcDayRange(cursor)                     // sheet's cursor
const query = useTransactions(
  { type: 'expense', categoryId: category?.id, ...range },
  { enabled: category !== undefined },
)
const categoryTransactions = query.data ?? []
```

The result feeds the existing `expenseDayGroups` / `totalExpenses` (exact
local-month trim), so the sheet's list and total converge with the section's
`categoryBreakdown` rows. The derivation block (currently recomputing
`expensesInMonth` twice per render) is wrapped in `useMemo`. The now-unused
`transactions` prop is removed from `CategoryExpensesSheetProps` and its call
site in `category-section.tsx` (data plumbing only; `categories` stays for row
labels). `type: 'expense'` is safe: the sheet only opens from expense
breakdown rows.

### D5. `useTransactions` gains an optional `{ enabled }` second parameter

Minimal pass-through to `useQuery` for conditional queries — exactly what the
sheet needs. Not a general options bag: TanStack options we don't need
(`placeholderData`, `staleTime`, …) stay out until a caller requires them.
Invalidation is untouched: the key `['transactions', options]` is already
parameterized by the filters, and mutations invalidate the `['transactions']`
prefix, which covers every filtered variant.

### D6. Helper tests: per-zone child processes under mobile jest

`packages/dates` has no test runner (type-check only); the established home
for its coverage is `apps/mobile/src/shared/lib/dates.test.ts`. The helper's
output is TZ-dependent by design, and a Jest process cannot change its own
zone: Jest sandboxes `process.env` (TZ writes never reach the real
environment), and fake timers' `timeZone` option only overrides
`getTimezoneOffset` — V8 resolves local `Date` construction against the real
process environment at construction time. The tests therefore live in a
dedicated sibling file (`apps/mobile/src/shared/lib/month-to-utc-day-range.test.ts`)
that spawns a child Node process per case with the target `TZ`, running the
real helper from `packages/dates/src/month.ts` (Node 24 type stripping; a
generated resolve hook appends `.ts` to the package's extensionless relative
specifiers). Cases: UTC, UTC+3 (`Europe/Moscow`), UTC−5/−4
(`America/New_York`, EST and EDT), a 31-day month, a 30-day month, and the
December→January wraparound; plus the superset window and local-month
membership asserted at boundary instants (00:30 local on the 1st, 23:30
local on the last day), evaluated in-zone by the child.

Existing suites must pass without edits — the mock repository already applies
all filters with the same inclusive-day semantics as SQLite, so
`dashboard-screen.test.tsx` exercises the filtered path for free.

## Risks / Trade-offs

- [Month switch in the category sheet briefly shows the empty state while the
  new key resolves] → Acceptable on SQLite (sync-fast); if it ever shows on
  HTTP, add `placeholderData: keepPreviousData` to the sheet query then. Not
  added now to keep the hook API minimal.
- [Superset loads up to two extra days of neighboring months] → Harmless:
  selectors trim; the extra rows never render. Slightly larger cache entry
  per month is negligible.
- [DST transitions (e.g. southern-hemisphere zones) shift local midnights] →
  Covered by construction: the helper uses actual local-month instants, not
  offset arithmetic; boundary unit tests pin the behavior.
- [Removing the sheet's `transactions` prop changes a component signature] →
  Internal to `pages/dashboard`; no external consumers (verified single call
  site).

## Migration Plan

Pure client-side rewiring, no schema or contract changes; single PR, all
tasks land together. Rollback is a plain revert — no data migration.
