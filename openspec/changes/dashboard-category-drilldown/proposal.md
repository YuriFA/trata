## Why

The dashboard's expenses-by-category breakdown is read-only: a row says
«Продукты — 12 400 ₽» but there is no way to see the transactions behind
the figure for the selected month. The analytics detail screen already
answers exactly this question with a category cashflow overlay; the
dashboard, where the question first arises, does not.

## What Changes

- Dashboard category breakdown rows become interactive: activating a row
  opens the category cashflow dialog scoped to that category and the
  dashboard's currently selected month. Period navigation inside the
  overlay, newest/oldest sorting, and transaction edit/delete come with
  the reused component; the dashboard itself stays unchanged otherwise.
- `CategoryCashflowDialog` is promoted from
  `pages/analytics-detail/ui` to the `widgets` layer (FSD forbids a page
  importing another page). The analytics detail screen switches to the
  promoted widget with no behavior change.
- Explicitly out of scope (decided in review): no changes to the
  transactions screen, its date filter control, or URL filter semantics;
  no mobile work (apps/mobile has no transactions list screen); no
  `packages/*` or backend changes.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `web-screens`: the Dashboard screen requirement gains the category-row
  drill-down contract - activating a breakdown row opens the category's
  transactions for the selected month in an overlay, matching the
  analytics detail screen's drill-down behavior.

## Impact

- `apps/web/src/pages/dashboard/ui/CategoryBreakdownCard.vue` - rows
  become buttons; dialog instance + active-category state added.
- `apps/web/src/widgets/<category-cashflow>/` - promoted dialog component
  (with its test moved along).
- `apps/web/src/pages/analytics-detail/ui/AnalyticsDetailView.vue` -
  import path switch to the promoted widget.
- i18n: no new keys expected (reuse of `analytics.*` keys); ru/en parity
  unaffected.
- Verification gates: `pnpm arch:check` (new widgets layer edge),
  `pnpm lint:design`, web type-check and unit tests.
