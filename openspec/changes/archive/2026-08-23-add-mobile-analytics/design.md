## Context

The analytics tab ships as a placeholder: `apps/mobile/src/app/(tabs)/analytics.tsx`
re-exports `src/pages/analytics/ui/analytics-screen.tsx` (a `ScreenPlaceholder`
with testID `screen-analytics`). The tab bar (`src/app/(tabs)/_layout.tsx`) and
the Maestro flow `02-tab-navigation.yaml` already cover the tab — no navigation
scaffolding is needed.

Everything the feature reads already exists locally:

- `useTransactions(options)` (`src/entities/transaction/model/use-transactions.ts`)
  queries the SQLite repository with `type`, `fromDate`, `toDate`
  (inclusive UTC calendar days); the table has indexes on `(type, occurred_at)`
  and `category_id` (`src/shared/lib/db/schema.ts`). Money is integer minor
  units end to end; `formatAmount` (`src/shared/lib/format/format.ts`) renders
  RUB/ru.
- The month-scoped pattern to generalize: `monthToUtcDayRange(cursor)`
  (inclusive UTC-day superset pre-filter) + `transactionsInMonth` (exact
  local-time trim), both in `packages/dates/src/month.ts`. Week/year
  equivalents exist nowhere in the repo; `grid.ts` pins Monday as the week
  start for calendars.
- Aggregation precedent: `categoryBreakdown(txs, categories, cursor, kind)` in
  `src/features/cashflow-overview/model/selectors.ts` — month-bound, integer
  sums, descending. FSD import rules (`/.dependency-cruiser.mobile.cjs`)
  enumerate feature slices in `FEATURE_SLICES`; a new slice must be added
  there or its imports fail `pnpm arch:check`.
- No chart library, no Skia, no react-native-svg anywhere in the workspace.
  The mobile AGENTS.md requires an explicit OpenSpec decision for a major new
  dependency — that decision is D3 here.
- Screen patterns: stack screens use `<Screen topInset={false}>` +
  `ScreenHeader` (back affordance, testID `screen-header-back`) +
  `ScreenScrollView` (`src/shared/ui/screen-header/`); tab roots use a plain
  in-screen display title (e.g. `transactions-screen.tsx`), not `ScreenHeader`.
  There is already a stack route `/income` titled «Доходы» (the income
  transactions screen) — analytics detail is a separate route; only the
  visible title coincides.

See proposal.md for motivation and product decisions (tab cards = current
month, future periods navigable, single-currency v1, top-5 + «Прочие»,
non-interactive summary row); the `analytics` spec delta is the behavioral
contract.

## Goals / Non-Goals

**Goals:**

- Fill the analytics tab and add one parametrized detail screen using only
  existing screens' patterns (ScreenHeader, Card, IconButton, Pressable).
- Period model (week/month/year) as a reusable, tested `packages/dates`
  export following the superset-pre-filter + exact-local-trim precedent.
- All aggregation in pure selectors over domain types — UI components never
  filter, group, or compute percentages/period boundaries themselves.
- Donut rendering with a small purpose-built component; no charting
  framework.
- Offline-first for free: analytics reads only repositories/query hooks; the
  existing global sync invalidation (`src/app/_layout.tsx`) refreshes it.

**Non-Goals:**

- No backend, OpenAPI, `packages/api`, or web changes; no new repository
  methods (`query()` filters suffice).
- No changes to `cashflow-overview` or the Home screen (scope hold;
  consolidation of month selectors with the period model is a possible future
  change).
- No chart animations, gestures, drill-down, budgets, export, or i18n wiring
  (RU strings hardcoded with `TODO(i18n)`, like every other screen).
- No reference-only extras: the tab's third «Расходы за год» card with its
  PRO badge is out of scope (Pro/subscription functionality is excluded from
  the product — `docs/product/mobile-home.md` precedent), and the reference
  tab bar's «Ещё» tab is not adopted (the existing tab set stands).

## Decisions

### D1. Pure client-side aggregation over filtered local queries

Each screen derives figures from `useTransactions({ type, fromDate, toDate })`
where the day range comes from the period cursor (D2), then applies pure
selectors for exact local-period membership and grouping. No new endpoints,
no full-history fetch: the query key is the options object, so each visited
period is cached separately and mutations/sync invalidate the
`['transactions']` prefix as today.

Alternative rejected: backend aggregation endpoints — unnecessary (data is
already on-device), and they would break the offline-first contract.

### D2. Period model in `packages/dates` (`src/period.ts`), anchor-based

```ts
export type AnalyticsPeriodKind = 'week' | 'month' | 'year'

/** Anchor cursor: local-midnight Date at the period's start
 *  (a Monday for weeks, the 1st for months, Jan 1 for years). */
export interface PeriodCursor {
  kind: AnalyticsPeriodKind
  start: Date
}

currentPeriod(kind, now?): PeriodCursor      // period containing `now`
shiftPeriod(cursor, steps): PeriodCursor     // ±N periods via date-fns
isSamePeriod(a, b): boolean
periodToUtcDayRange(cursor): { fromDate: string; toDate: string } // UTC-day superset
transactionsInPeriod(txs, cursor): T[]       // exact local-time membership
periodRangeLabel(cursor, locale?): string    // "3 августа – 9 августа" etc.
```

- Anchor representation (a start `Date`) instead of `{year, weekIndex}`:
  ISO week numbering has pitfalls (week 53, Jan 1 belonging to the previous
  year's week 1) that shifting/deriving from a concrete start date avoids
  entirely; `shiftPeriod` is `addWeeks/addMonths/addYears` on the anchor.
  `MonthCursor` stays untouched for its existing consumers.
- `periodToUtcDayRange` generalizes `monthToUtcDayRange`'s construction
  (local period instants → `toISOString().slice(0, 10)`); correctness still
  comes from `transactionsInPeriod` (`isSameWeek { weekStartsOn: 1 }` /
  `isSameMonth` / `isSameYear`) applied on top. Plain `Date` API + date-fns
  only; no `@trata/api` import (keeps the package a leaf).
- `periodRangeLabel`: week "3 августа – 9 августа", month "1 августа – 31
  августа", year "1 января – 31 декабря 2026"; week/month labels append the
  year when the range spans two calendar years. The donut center renders the
  label upper-cased at the UI seam (`label.toUpperCase()`), mirroring the
  reference's "1 АВГУСТА – 31 АВГУСТА".
- Future periods are just cursors: nothing in the model knows "now" beyond
  `currentPeriod`, so navigation never needs blocking (product decision).

Alternative rejected: per-kind cursor types (`WeekCursor`/`YearCursor`
mirroring `MonthCursor`) — three parallel shapes for one selector to juggle;
the anchor unifies shift/label/range logic behind one kind tag.

### D3. Donut: `@shopify/react-native-skia` + a small local `DonutChart`

Add `@shopify/react-native-skia` (pin the version Skia's Expo compatibility
table recommends for SDK 57 / RN 0.86 at implementation time). Build one
component in the analytics slice — not a generic charting framework:

```ts
interface DonutSegment {
  value: number   // integer minor units (relative sizing only)
  color: string   // category hex (data color), or the «Прочие» neutral
}
interface DonutChartProps {
  segments: DonutSegment[]  // pre-sorted, pre-capped by selectors (D4)
  size: number
  strokeWidth: number
  gapDegrees?: number       // small angular gap; ignored when 1 segment
  children?: React.ReactNode // center content: plain RN nodes over the Canvas
}
```

- Arcs are drawn as stroked Skia paths (butt caps) sized by each segment's
  share of `segments`' total; a single segment renders a full ring without
  gaps. Center content is regular RN children absolutely positioned over the
  `Canvas` — no Skia text/font plumbing.
- Detail-screen interactivity (added): every segment carries an `id`;
  `selectedSegmentId` widens that segment's stroke slightly (the segment
  stays in place — no reordering) and dims the others (Skia `opacity`), and
  `onPressSegment(id)` reports taps. Hit-testing is manual and pure: a
  Gesture.Tap on the chart wrapper yields view coordinates, which
  `segmentAt(segments, size, strokeWidth, x, y)` maps to a segment id by
  angle from 12 o'clock (accumulated sweeps) and radius within the ring
  band; the helper is exported for unit tests. The chart stays non-interactive
  by default — the tab cards pass no selection props.
- Pairs with the already-installed Reanimated if animation is ever wanted;
  GPU-backed; first-class Expo dev-build support via its config plugin.
- Costs: a new native module (one-time iOS dev build rebuild — the app
  already ships `expo-dev-client`, so nothing changes about distribution) and
  a Jest mock (D9).

Alternatives rejected: `react-native-svg` (equally capable for a static donut
and lighter, but Skia is the decided direction, matches the existing
animation stack, and both require the same dev-build rebuild anyway);
`victory-native`/chart kits (import a framework for one chart — against the
"no generic charting framework" constraint).

### D4. New slice `src/features/analytics`: selectors + chart, `cashflow-overview` untouched

- `model/selectors.ts` (pure, over `@trata/api` domain types):
  `categoryTotals(txs, categories, cursor, kind)` (exact-period trim by
  `transactionsInPeriod`, `type === kind` filter excludes transfers by
  construction, integer minor-unit sums, descending), `periodTotal(txs,
  cursor, kind)`, `percentLabel(part, total)` (at most two fractional digits
  with trailing zeros dropped, ru comma — "66,32%", "22,5%"), and `toChartEntries(totals, { top = 5 })` returning the
  top-N entries plus an aggregated «Прочие» entry when more exist. After the
  interactivity update, `toChartEntries` serves ONLY the tab cards; the
  detail screen charts the raw `categoryTotals` list (no cap, no «Прочие»)
  filtered by its checkbox state — the chart renormalizes among the included
  segments by construction (it sizes by the segments' own total).
- `ui/donut-chart.tsx` (D3) and `ui/chart-legend.tsx` (color-dot rows) live
  here because two screens consume them (tab cards + detail); the period
  selector/stepper stay page-local in `pages/analytics-detail/ui/` (single
  consumer, per the AGENTS.md "don't prematurely promote" rule).
- `config/other-entry.ts`: the neutral hex for «Прочие» — data color for the
  canvas, same precedent as `entities/category/config/category-appearance.ts`;
  the `design-tokens-guard` exemption list must include this new file.
- Add `'analytics'` to `FEATURE_SLICES` in `/.dependency-cruiser.mobile.cjs`
  or every cross-import inside the slice fails `pnpm arch:check`.
- `cashflow-overview` is deliberately untouched: its selectors are
  `MonthCursor`-bound with different presentation types; forcing a shared
  abstraction now would churn the dashboard for no behavior change. Possible
  consolidation is noted for a future change.

### D5. Routes and screen placement

- Tab screen: replace the placeholder body of `pages/analytics/ui/` keeping
  testID `screen-analytics`. Tab-root pattern: plain `Text variant="display"`
  title («Аналитика») like `transactions-screen.tsx` — no `ScreenHeader`, no
  back, no collapse.
- Detail: one route `src/app/analytics-detail.tsx` (thin re-export) +
  `Stack.Screen name="analytics-detail"` in `src/app/_layout.tsx`. The screen
  reads `useLocalSearchParams<{ type: 'expense' | 'income' }>()` (invalid or
  missing param falls back to `'expense'` — deep-link robustness) and renders
  ONE reusable `AnalyticsDetailScreen` in `src/pages/analytics-detail/ui/`
  parameterized by direction. Stack pattern: `<Screen topInset={false}>` +
  `ScreenHeader` (title «Расходы»/«Доходы», default `router.back()`) +
  `ScreenScrollView`.
- Navigation from cards: `router.push({ pathname: '/analytics-detail',
  params: { type: 'expense' } })` (likewise `income`).
- The existing `/income` screen keeps its route; testIDs disambiguate
  (`screen-analytics-detail` vs the income screen's own).

### D6. State and data flow (per `docs/conventions/components-and-state.md`)

- Tab screen: stateless — `const cursor = currentPeriod('month')` per render;
  two queries (`type: 'expense' | 'income'` + the cursor's day range) and
  `useCategories()` filtered by kind client-side.
- Detail screen: a single `useState` cursor (default `currentPeriod('month')`,
  kind derived from it) plus `lastDirection` (1/-1 — the last carousel step,
  driving the chart slide direction) and the interactivity state —
  `selectedCategoryId` (segment tap, toggle to deselect) and `excludedIds:
  Set<string>` (row checkboxes, master toggle writes all ids or clears).
  Period changes (kind switch, arrows, swipe) go through one `applyPeriod`
  handler that also clears selection and exclusions — the fresh period
  starts as the complete picture (no effect-sync; the reset happens in the
  handlers, per conventions §2). The drill-down keeps the category id in
  state for the mounted sheet. Nothing persists across opens.
- Figures are derived at render from `query.data ?? []` through the D4
  selectors — no `useMemo` mirrors, no effects (personal-finance scale; the
  worst case, a year of transactions pre-filtered in SQL, is linear grouping
  over a bounded list). Loading/error handling follows the existing screens:
  local reads are near-synchronous, so no spinners; queries don't mutate, so
  no screen-local error state is needed.

### D7. Presentation composition

- Tab cards: `Pressable` wrapping `Card variant="elevated"`; header row
  («Расходы» + chevron-forward icon), donut (small, center = muted «СУММА»
  caption above the `formatAmount` total, per reference) beside the legend;
  the card legend is color dot + category name only — amounts and
  percentages appear only in the detail breakdown; empty state replaces
  donut + legend with a muted message card («Нет расходов за этот период»).
- Detail (always the full layout, even for a period without movement —
  zeroed figures instead of an empty state): total line («30 325 ₽» + muted
  «всего»; 0 for an empty period), chart section `[◀ IconButton] DonutChart(216)
  [▶ IconButton]` with the upper-cased `periodRangeLabel` in the donut
  center (the center Text carries `analytics-period-label`), then the
  breakdown card. The section's Gesture.Pan (`activeOffsetX ±15`,
  `failOffsetY`) steps periods on swipe; ONLY the chart animates — an
  `Animated.View` keyed by the period remounts with `SlideInLeft/Right`
  (250ms) per the step direction, the arrows/totals/list stay static.
  Three-way selector via the Button variant-swap pattern. The list shows
  every direction category (`categoryTotals` zeros merged in, desc by
  amount): summary row = master checkbox (neutral primary/border look,
  full-period total, 100%); category rows = per-row checkbox painted with
  the CATEGORY color (checkmark = included; unchecked dims to 40%; the
  separate color dot is gone) + pressable row body (name, `formatAmount`,
  `percentLabel` — always vs the full period total) opening the category
  sheet; with an active selection the selected row moves first and the
  others get `opacity-*`. Nothing chartable (no movement or all excluded)
  renders the grey ring (`other-entry` hex) instead of segments.
- Colors: category hexes ride inline `style` (the sanctioned data-color
  exception); every other color is a token class. Money via `formatAmount`;
  percentages via the D4 formatter. RU strings hardcoded with `TODO(i18n)`.

### D8. Accessibility and testIDs

- Cards: `accessibilityRole="button"`, dynamic `accessibilityLabel`
  («Расходы за август 2026, 30 325 ₽»), testIDs `analytics-card-expenses` /
  `analytics-card-income`.
- Chart container: `accessibilityLabel` summarizing the capped breakdown
  («Расходы по категориям: Такси 66%, ...»); the chart is never the only
  source of the data (legend/list carry the same values as text).
- Period selector options: `accessibilityState={{ selected }}`, testIDs
  `analytics-period-week|month|year`; arrows: IconButtons with labels
  «Предыдущий период»/«Следующий период», testIDs `analytics-period-prev` /
  `analytics-period-next`.
- Detail rows: `analytics-category-<id>` (id suffix per bottom-tab-bar
  precedent for stable dynamic keys), summary `analytics-total-row`, screen
  root `screen-analytics-detail`. Checkboxes: `accessibilityRole="checkbox"`
  with `accessibilityState={{ checked }}` — per-row
  `analytics-category-check-<id>`, master `analytics-total-check`; the row
  body is a `button`-roled pressable («Открыть траты по категории …») since
  the tap target differs from the checkbox. Segment selection and swipe have
  no non-gesture path by design; screen readers get the same data through
  the rows, and the arrows remain the accessible period navigation.

### D10. Drill-down reuses the shared category sheet, generalized to periods

`CategoryCashflowSheet` (`features/cashflow-overview`) is month-bound today
(`initialCursor: MonthCursor`, `monthToUtcDayRange`, month prev/next,
`monthRangeLabelShort`). It gains an optional `initialPeriod?: PeriodCursor`:
when provided, the sheet's internal navigator steps same-kind periods via
`shiftPeriod`, fetches via `periodToUtcDayRange`, labels via
`periodRangeLabel`, and groups/totals via new period-aware variants
(`cashflowInPeriod` / `cashflowDayGroupsInPeriod` / `totalCashflowInPeriod`)
added beside the month selectors in `cashflow-overview/model/selectors.ts`
(the month grouping body is extracted once and shared). Month callers
(dashboard, income) pass only `initialCursor` and keep byte-identical
behavior — including the short month label. The sheet's existing
affordances (edit category, new-transaction footer) come along unchanged;
the analytics page composes `NewTransactionSheet` itself (invariant #15 —
features never import the create-transaction slice). testIDs stay the
shared `CASHFLOW_KIND_VIEWS[kind].ids` (instances never co-mount).

### D9. Testing strategy

- `packages/dates` has no test runner (type-check only); its coverage lives
  in `apps/mobile` (established by `month-to-utc-day-range.test.ts`). Reuse
  that file's per-zone child-process harness for the new helpers: week ranges
  (Monday start, week spanning Dec 31 → Jan 1), year wraparound, superset
  property vs `transactionsInPeriod` membership at boundary instants (00:30
  local on the first day, 23:30 local on the last), label snapshots (ru).
- Selector unit tests (plain jest): aggregation by category, transfer
  exclusion, empty/single/many categories, top-5 + «Прочие» capping and
  ordering, percent rounding, integer minor-unit sums.
- Component tests (RNTL + the `mock-*-repository.ts` harness): tab cards
  (totals, legend, empty state, press navigation), detail screen (default
  month, kind switching resets cursor, arrows change the label, breakdown
  rows with percentages, empty period) — extended for interactivity:
  checkbox/master `accessibilityState.checked` transitions, exclusion state
  feeding the chart (grey-ring case), row tap presenting the category sheet,
  and the pure `segmentAt` hit-test helper unit-tested (angle accumulation,
  gap handling, radius band, misses). Segment taps and swipes themselves are
  gesture-driven and stay e2e-only. Add a `@shopify/react-native-skia`
  mock to `jest.setup.js` (no-op Canvas rendering children) — same pattern as
  the existing reanimated/blur mocks; tests assert testIDs/labels, never
  pixels.
- Maestro `apps/mobile/.maestro/flows/12-analytics.yaml` (next number after
  `11-income`): open tab → cards visible → open expenses detail → back
  affordance → switch Неделя/Месяц/Год → step periods → category rows and
  totals visible — extended with a category-row drill-down (+ sheet close),
  a checkbox toggle, a master-checkbox toggle, and a swipe over the chart.
  `02-tab-navigation.yaml` must stay green (placeholder testID retained).

## Risks / Trade-offs

- [Skia version mismatch with Expo 57 / RN 0.86 New Architecture] → Pin per
  Skia's compatibility table at implementation time and verify the dev build
  boots before building screens; `react-native-svg` remains the documented
  fallback (D3) if Skia blocks.
- [New native dependency = dev build rebuild] → One-time `pnpm ios` rebuild;
  the app already distributes via `expo-dev-client`, not Expo Go; CI is
  JS-only and unaffected.
- [Skia under Jest] → Mock in `jest.setup.js` exactly like the existing
  reanimated/blur/bottom-sheet mocks; component tests assert behavior and
  testIDs, not rendered pixels.
- [Year-scope data volume] → Bounded by the indexed SQLite range pre-filter;
  in-memory grouping is linear over that bounded set; no pagination needed at
  personal-finance scale (revisit only if a real dataset proves otherwise).
- [Selector overlap with `cashflow-overview`] → Accepted duplication
  (~20-line grouping) with different input semantics; consolidation is
  explicitly deferred (D4) to avoid churning the dashboard.
- [«Прочие» neutral hex trips `design-tokens-guard`] → Add the analytics
  config file to the guard's exemption list, same precedent as
  `category-appearance.ts`.
- [Two screens titled «Доходы»] → Routes and testIDs are distinct; Maestro
  selects by testID, so no ambiguity.

## Migration Plan

Additive, single PR, no schema/contract/data changes: land `packages/dates`
helpers → slice + chart → screens + route → tests/Maestro. The placeholder
screen body is replaced in place (route, tab entry, and `screen-analytics`
testID unchanged). Rollback is a plain revert plus one dev build rebuild
(Skia removal). Requires the one-time native rebuild when Skia is installed.
