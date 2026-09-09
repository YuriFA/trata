## Context

The dashboard's `CategoryBreakdownCard` (`pages/dashboard/ui`) renders
read-only rows from `categoryTotals(...)` for the page-owned month cursor.
The analytics detail screen already solves "category -> its transactions
for the period" with `CategoryCashflowDialog`
(`pages/analytics-detail/ui`): a `ResponsiveDialog` listing the
category's transactions with dialog-local period navigation, newest/oldest
sorting, and transaction edit/delete, fed by `useTransactions({ type,
categoryId, ...periodToUtcDayRange(cursor) })` with exact local-day
membership via `transactionsInPeriod`.

FSD constraint: a page must not import another page's module, so reusing
the dialog on the dashboard requires promoting it to the `widgets` layer
(existing segments there: `command-palette`, `mobile-shell`,
`sync-status`). The dialog's own imports (`entities/*`, `features/*`,
`shared/*`, `@trata/*`) are all legal from `widgets`, so the
promotion is a move plus import-path updates, not a refactor.

## Goals / Non-Goals

**Goals:**

- Activating a dashboard breakdown row opens the category cashflow
  overlay scoped to the selected month (spec delta: `web-screens`,
  Dashboard screen requirement).
- One drill-down component serves both consumers (analytics detail and
  dashboard) - same gesture, same surface.

**Non-Goals** (see proposal for scope boundaries):

- No changes to the transactions screen, its filters, or URL semantics.
- No new i18n keys; the overlay reuses `analytics.*` copy.
- No data-layer, `packages/*`, or backend changes.

## Decisions

1. **Reuse the dialog; do not navigate and do not build an inline
   accordion.** The dashboard question is a peek ("where did this figure
   come from this month?"), not a filtering workflow. Navigation to
   `/transactions` would work (URL filters already parse
   `categoryId`/`from`/`to`) but is the heaviest gesture and would have
   dragged a period-control rework that review cancelled. An accordion is
   strictly more work than the dialog for the same content (duplicate or
   re-shell the list, edit/delete wiring, sorting). The dialog is the
   established pattern for exactly this gesture in analytics.
2. **Promote to `widgets/category-cashflow-dialog/`.** Kebab-case segment
   naming follows the existing widgets. The component, its props contract
   (`category`, `direction`, `cursor`, `open` model), and testids move
   unchanged; `AnalyticsDetailView` switches to the promoted import.
3. **Dashboard integration mirrors the analytics view's state pattern:
   one dialog instance plus an active-category ref**
   (`drilldownOpen` + `drilldownCategory`, `v-if` + `:key` on the
   category id). The breakdown row becomes a `<button>` wrapping the
   existing row layout (full-width, text-left), matching how the
   analytics breakdown rows open the same dialog. Direction is the
   literal `'expense'` - the breakdown is expense-only by construction.
4. **Clear the active category when the overlay closes** (both
   consumers), so the next activation remounts the dialog and snapshots
   the current cursor. Today `AnalyticsDetailView` keeps
   `drilldownCategory` set after close; reopening the same category
   after switching the view period shows the stale period because the
   dialog's `localCursor` initializes once at mount. Clearing on close
   fixes the dashboard's "drill-down follows the selected month"
   scenario and the analytics equivalent, and makes dialog-local state
   (period steps, sort) transient per peek - the intended semantics.

## Risks / Trade-offs

- [arch:check flags the new widget's imports] -> verified legal
  (`widgets` may import `entities`/`features`/`shared`); gate runs in
  verification.
- [Row button styling drift from the design system] -> run
  `pnpm lint:design` after the UI change; reuse token-based hover
  affordances like the card's existing footer button.
- [Analytics detail behavior changes subtly] -> the only change is that
  reopening the same category after a period switch now respects the new
  period (bug fix aligned with the analytics spec's drill-down wording);
  covered by the existing `AnalyticsDetailView.test.ts` suite plus the
  new card test.

## Migration Plan

Pure frontend change; no data, API, or schema impact. Deploy and
rollback are a normal revert of the commit.
