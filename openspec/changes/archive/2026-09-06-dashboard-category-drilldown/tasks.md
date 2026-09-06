## 1. Widget promotion

- [x] 1.1 Move `CategoryCashflowDialog.vue` from `apps/web/src/pages/analytics-detail/ui/` to `apps/web/src/widgets/category-cashflow-dialog/`, following the segment conventions of the existing widgets (`command-palette`, `mobile-shell`, `sync-status`); props, behavior, and testids unchanged
- [x] 1.2 Switch `AnalyticsDetailView.vue` to the promoted widget import and remove the old page-local file

## 2. Dashboard drill-down

- [x] 2.1 In `CategoryBreakdownCard.vue`, make each breakdown row a full-row `<button>` that opens the promoted dialog for that category: single dialog instance + active-category ref (`v-if` + `:key` on category id), `direction` fixed to `'expense'`, `cursor` from the card prop, `data-testid="dashboard-category-row-<id>"`, token-based hover affordance consistent with the card footer button
- [x] 2.2 Clear the active category when the dialog closes, in both consumers (dashboard card and `AnalyticsDetailView`), so each activation remounts the dialog and snapshots the current cursor (fixes the stale-period reopen in analytics)

## 3. Tests

- [x] 3.1 Add `CategoryBreakdownCard.test.ts`: activating a row opens the overlay scoped to that category and the selected month; switching the dashboard month and activating again rescopes the overlay
- [x] 3.2 Add a Playwright spec for the dashboard category drill-down (seeded via the CSV import wizard, dates from the real clock): click a breakdown row, assert the overlay lists that category's transactions for the selected month and the in-overlay period navigation works

## 4. Verification

- [x] 4.1 Web workspace gates: `pnpm --filter web type-check`, `test:unit`, `lint:design`, `lint:fsd`, `i18n:lint`
- [x] 4.2 Root gates: `pnpm arch:check`, `pnpm knip` (arch:check green; knip red on 4 pre-existing unused type exports in `shared/services/notification` - user's concurrent WIP, untouched by this change)
