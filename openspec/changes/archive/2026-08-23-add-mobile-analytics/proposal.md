# Proposal: add-mobile-analytics

## Why

The mobile app's «Аналитика» tab is a shipped placeholder
(`ScreenPlaceholder`, "появится позже"): the product promises spending
insight but delivers none. Users can only see per-category totals for the
current month on the Home/Income screens; there is no way to view expense or
income distribution over a chosen week/month/year. Everything analytics needs
is already on-device — the offline-first SQLite store holds every transaction
with `type`, `categoryId`, and `occurredAt`, and the repository seam already
supports type + inclusive-date-range filtering — so the feature needs no
backend or OpenAPI change.

## What Changes

- **Analytics tab overview.** Replace the placeholder screen with two
  pressable summary cards — «Расходы» and «Доходы» — each showing a donut
  chart by category, a color-matched legend of top categories, and the
  direction total in the donut center.
- **Product decision: the tab cards show the current device-local month.**
  The tab has no period selector of its own; tapping a card opens that
  direction's detail screen.
- **One parametrized detail screen (expenses | income).** A new stack screen
  with a back header («Расходы»/«Доходы»), a week/month/year selector
  (default: month, current period), previous/next arrows flanking the chart
  (the range label lives in the donut center) plus a left/right swipe over
  the chart section stepping periods, the direction total, and the full
  per-category breakdown (amount + percentage). One reusable screen driven
  by the direction parameter, not two parallel implementations.
- **Product decision: the detail donut is interactive.** Tapping a segment
  selects its category — the segment scales up in place while the other
  segments dim, and in the breakdown list that category's row moves to the
  top with the other rows dimmed; tapping the segment again deselects, and
  any period change resets selection and filtering. Every breakdown row
  carries a checkbox colored with its category's color: unchecked categories
  drop out of the donut, which renormalizes among the checked ones (the ring
  stays full); «Все расходы» / «Все доходы» is a master checkbox (on iff
  every category is included; off leaves a neutral grey ring). Row
  percentages and the summary total always stay relative to the FULL period
  total. Period switches animate only the chart, sliding it in the step
  direction like a carousel while the rest of the screen stays static; a
  period without movement renders the same full layout with zero figures
  (neutral ring, total 0, every category at 0) instead of an empty state.
  Tapping a category row outside its checkbox drills into that category's
  transactions through the shared category sheet, generalized from
  month-only to the period model.
- **Presentation caps: top-5 + «Прочие» on the tab cards only.** The tab
  cards' small donuts and legends show at most five category segments plus
  an aggregated «Прочие» segment; the detail chart shows every category
  individually — interactive filtering supersedes a static cap there.
- **Product decision: future periods are navigable.** Neither arrow is ever
  disabled; a future (or empty) period shows the empty state. This diverges
  deliberately from the Home screen's "no future months" rule, which stays
  unchanged for Home.
- **Product decision: period attribution is device-local calendar time;
  weeks start on Monday.** A transaction belongs to a period iff its
  occurred-at instant falls within that period in the device's local
  timezone, consistently across every period-scoped figure — the same rule
  the home screen already pins for months, extended to weeks and years.
- **New period model in `@trata/dates`.** A week/month/year cursor
  plus current/shift/range/label helpers, following the established
  superset-pre-filter + exact-local-trim pattern (`monthToUtcDayRange` +
  `transactionsInMonth`).
- **Client-side aggregation only.** A new `features/analytics` slice computes
  per-category totals in integer minor units from the existing filtered
  transactions query. Transfers are excluded (a transfer is neither income
  nor expense); no API, contract, or schema change.
- **Product decision: single-currency v1 totals.** Amounts are summed as-is
  in minor units with no conversion, per the existing Home-screen decision
  (`docs/product/mobile-home.md`), and displayed through the existing
  RUB/ru formatter.
- **New dependency: `@shopify/react-native-skia`.** The app's first
  chart-rendering dependency: a small purpose-built local `DonutChart`
  component, not a charting framework. Recorded here as the explicit adoption
  decision per the mobile AGENTS.md rule on major libraries.

## Capabilities

### New Capabilities

- `analytics`: mobile analytics screens — the tab overview cards and the
  period-scoped (week/month/year) expense/income breakdown by category,
  including period attribution, navigation, empty states, and presentation
  caps.

### Modified Capabilities

(none)

## Impact

- **Mobile (`apps/mobile`)**: replace the placeholder `pages/analytics` tab
  screen (keeping its `screen-analytics` testID); new stack route
  `src/app/analytics-detail.tsx` with `Stack.Screen` registration; new slice
  `src/features/analytics` (aggregation selectors, `DonutChart`, legend),
  added to `FEATURE_SLICES` in `.dependency-cruiser.mobile.cjs`; a Skia jest
  mock in `jest.setup.js`; new Maestro flow `12-analytics.yaml`. RU strings
  hardcoded with `TODO(i18n)` per the pending i18n wiring.
- **Shared package (`packages/dates`)**: new platform-agnostic period model
  and label helpers (no `@trata/api` import).
- **Dependencies**: add `@shopify/react-native-skia` (native module — iOS dev
  build rebuild required; not Expo Go).
- **Out of scope**: backend, OpenAPI contract, the web app, other chart types
  (line/bar), budgets/limits/insights, export (PDF/CSV), multi-currency
  conversion, i18n wiring, and the reference tab's third card «Расходы за
  год» behind a PRO badge — Pro/subscription functionality stays excluded
  from the product per the `docs/product/mobile-home.md` precedent (the
  reference tab bar's «Ещё» tab is likewise not adopted). The drill-down
  reuses the shared category sheet as-is, so its existing affordances (edit
  category, new transaction) come along; no new analytics editing surface is
  added.
