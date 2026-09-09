# Web Vue conventions

Canonical conventions for `apps/web` (Vue 3): the query idiom for async
state, the reactivity budget, forms, and list/dialog composition. FSD
placement and layering live in `apps/web/docs/ARCHITECTURE.md`; this document
covers the patterns inside components.

These are reference patterns extracted from the code as it exists — every
example cites its file. Adapt them; don't copy-paste.

---

## 1. Async state: the query idiom

Server/repository data goes through entity composables (Pinia Colada
`useQuery`/`useMutation`) — never hand-rolled loading refs.

- Canonical: `pages/dashboard/ui/RecentTransactions.vue` — three queries,
  `isPending`/`error` as OR-aggregating computeds over their refs, one
  combined `refetch`.
- Registered deviation: `pages/settings/ui/SettingsPage.vue` keeps
  `sessions`/`sessionsLoading`/`revoking` refs plus `onMounted` and manual
  try/finally around a direct `sessionApi` call. The direct call is the
  sanctioned session-API exception (invariant #11); the manual loading-state
  shape is NOT a pattern to copy — new async state gets a query/mutation
  composable in the entity's `model/` segment.

The seam is fixed and must not be short-circuited: component →
`entities/<x>/model/use-*.ts` composable → `use<X>Repository()` (inject) →
repository implementation bound to the `apiClient`. No component imports a
repository, the `apiClient`, or `@trata/api` directly.

### Loading states: skeletons are for "no data yet" ONLY

Skeletons/empty branches gate on `isPending` (`status === 'pending'`:
the query has neither data nor an error), never on `isLoading`
(`asyncStatus === 'loading'`: ANY fetch is in flight, including a
background refetch). This is the stale-while-revalidate contract: an
invalidated query refetches in the background while the previous data
stays rendered — mutations and sync cycles (which invalidate broadly) must
never blank a screen and redraw it. Colada's `isLoading` is NOT React
Query's `isLoading` (first load only); it maps to React Query's
`isFetching` and may only drive non-destructive indicators (e.g. a subtle
spinner), never replace rendered content. `enabled`-gated queries combine
`isPending` with the gate (`auth.isAuthenticated &&
householdQuery.isPending.value` — `SettingsPage.vue`) so a disabled query
never shows a stuck skeleton.

### Cache invalidation

Mutations invalidate every affected key in `onSettled`: transaction creates
invalidate `['transactions']` AND `['accounts']` — balances change
(`entities/transaction/model/use-transactions.ts`). A locale change
invalidates `['categories']` because category labels are locale-mapped
(`app/setup-i18n-locale-watcher.ts`). Optimistic updates go through
`shared/lib/use-optimistic-mutation.ts` (snapshot → patch → rollback on
error → invalidate on settle) — never ad-hoc `setQueryData` in components.
Sync cycles do NOT invalidate broadly: `sync-composable.ts` refreshes the
`['sync']` status cache after every completed engine cycle and the local-data
entity roots (`['transactions']`, `['accounts']`, …) only when the cycle
actually wrote local rows.

## 2. Reactivity budget

Production `watch()` calls are the exception, and every one bridges an
external system that cannot emit a component event:

- i18n: settings store → global locale, locale → category-cache
  invalidation (`app/setup-i18n-locale-watcher.ts`, two watchers);
- theme: settings store → `<html>` class (`app/setup-theme-watcher.ts`);
- sync: auth state and the mutation outbox drive the engine
  (`shared/lib/local-db/sync-composable.ts`, two watchers);
- router: navigation dismisses the transient speed dial
  (`widgets/mobile-shell/ui/SpeedDialFab.vue` — no parent could pass an
  event between the sibling shell widgets);
- one semantic UI watcher: the create-category type switch replaces an
  icon the new type does not offer (`CategoryEditDialog.vue`).

That is the budget — a new `watch` must justify itself against this list.
Draft/commit UI state syncs through event handlers, not watchers. That
includes open-triggered effects: a hosted dialog resets by remount
(§4 destroy-on-close — a fresh mount IS the reset, no reseed watches), and
a self-hosted dialog whose trigger must stay mounted resets or loads on
open inside an `@update:open` handler (canonical: `ImportCsvDialog`,
`DissolveHouseholdDialog`).

- Derived values are `computed` — never a `ref` kept in sync by a watch or
  an event: `entities/transaction/ui/TransactionListItem.vue` derives
  category/account/currency from props;
  `features/transaction/add/ui/CashflowForm.vue` derives `accountCurrency`
  from the watched account field + accounts data.
- Draft/commit UI state syncs through event handlers, not watchers:
  `pages/transactions/ui/TransactionsDateFilter.vue` copies the URL filters
  into the popover's draft in `handleOpenChange` and commits back on Apply —
  the draft is a `shallowRef`, everything derived from it is `computed`.
- The URL is the source of truth for list filters:
  `pages/transactions/model/use-transactions-filters.ts` parses
  `route.query` into a `computed` and mutates via `router.replace`.
- Watch out for `.value` snapshots breaking reactivity: passing
  `locale.value` into a non-reactive option freezes the result on the
  startup locale — see `useDateFormat(..., { locales: locale.value })` in
  `TransactionListItem.vue` (a registered trade-off, not a pattern to
  replicate).

## 3. Forms (vee-validate + Zod)

- Stack: `useForm({ validationSchema: toTypedSchema(createXSchema()) })`
  with a schema FACTORY in the feature's `model/` segment so messages
  re-resolve `t()` at form mount
  (`features/transaction/add/model/cashflow-schema.ts`); form value types
  infer from the schema.
- Money: majors (number) inside the form; `toMinorUnits` exactly once in the
  submit handler; `toMajorUnits` when loading edit values (invariant #2).
- Cross-field rules belong in the schema (`.refine`/`superRefine`), not in
  the submit handler. Registered deviation:
  `features/transaction/edit/ui/TransferEditForm.vue` checks
  transfer-accounts currency equality in the submit handler via
  `setFieldError` (it needs the accounts list); if you can express the rule
  in the schema, do.
- Failure: toast via `notification.mutationError` (code-keyed, never HTTP
  status); the error context is typed — `feature`/`action` are closed
  unions (`shared/services/notification/types.ts`), so a typo'd context
  fails type-check instead of silently landing in the logs. Success:
  `emit('success')` to the parent; entered values are kept on error.
  Delete confirms are the one exception that closes in `finally` — no
  draft to keep, the toast carries the failure (canonical:
  `DeleteTransactionDialog`, `CategoryDeleteDialog`).
- Known trade-off: schema factories snapshot `t()` at creation — validation
  messages switch locale only on remount. Accepted; don't "fix" silently.

## 4. Lists and overlays

One overlay instance OUTSIDE the loop plus an "active item" ref:

- Canonical: `pages/dashboard/ui/RecentTransactions.vue` —
  `activeTransaction`/`pendingDeleteId` refs; row actions call
  `openEdit(item)`/`openDelete(item)`; the two dialogs render once after
  the list. `pages/transactions/ui/TransactionsItemsList.vue` follows the
  same hoisted shape (its historical per-row defect is fixed).
- Dialog drafts reset by remount (destroy-on-close): the host renders the
  dialog under `v-if="open"` + `:key="<target id>"`, so the draft seeds are
  plain initializers from props and a fresh mount IS the reset — no reseed
  watches (canonical: `CategoriesSettingsPage` → `CategoryEditDialog`/
  `CategoryDeleteDialog`; `DebtsPage`). A self-hosted dialog whose trigger
  must stay mounted cannot remount: its open-triggered reset/effects go in
  an `@update:open` handler (§2).
- Overlay container owns presentation and lifecycle; the inner form/list owns
  only its own state and submission. Use one `open` ref in the container,
  close on success there, and keep reusable form logic out of
  `responsive-dialog` / `drawer` specifics. Exception: a form used by exactly
  one dialog surface owns its shell instead (v-model:open + title +
  `#footer`; canonical example: `EditAccountForm`) so the thin wrapper
disappears.
- Modal create/edit/detail/history surfaces use `shared/ui/responsive-dialog`:
  below 768px it renders the shared `drawer/`, at 768px+ the shared `dialog/`.
  Put title/description/actions in the container slots; account/category rows
  use the responsive select variant and day picking goes through
  `shared/ui/date-field`.
- The shell defaults to the bordered anatomy (hairline under the header,
  full-bleed hairline above the footer band, close X in the header row —
  canonical example: `CategoryEditDialog`). The header is pinned to the top
  and the footer band to the bottom of the overlay; the body is the only
  scrolling region (desktop: the shell body carries `overflow-y-auto`,
  mobile: the `drawer` shell wraps just the body slot). Panel geometry lives
  on the sections, not the panel - the desktop shell neutralizes the
  `dialog/` panel's built-in `p-6` and every section pads itself, mirroring
  the drawer shell; a contract test in `ResponsiveDialog.test.ts` bans
  negative-margin breakouts from the shell classes. Put submit/cancel
  actions in the `#footer` slot, linking them to the body form via the
  form's `id` + the button's `:form`; when the footer must stay inside the
  form component (submit state lives there), reuse the exported
  `DIALOG_FORM_FOOTER_CLASS` instead of hand-rolling the `-mx-6` breakout
  classes — it sticks to the bottom of the scrolling body so the buttons
  stay visible. Don't put `overflow-y-auto` on the panel `class` — cap
  height only (`max-h-[...]`), the body already scrolls. For edge-to-edge
  body content (full-bleed lists that pad themselves), use
  `body-variant="flush"` on the shell instead of hand-rolled `-mx-6`
breakouts (canonical example: `DebtorHistoryDialog`).
- Exemptions stay explicit at the call site: destructive confirms stay on
  `alert-dialog`, the command palette stays a centered `dialog`, and the
  transactions filters stay `drawer` below 768px plus right-side `sheet` at
  768px+. The plans form keeps its native `<input type="date">`, and the
  transactions range calendar stays the existing popover inside the filters
  drawer.

## 5. i18n and dates in components

- `useI18n()` only — `$t`/`$d`/`$n` in templates are eslint-banned; no raw
  text; `pnpm i18n:lint` runs the strict key checks.
- Dates: import only from `@/shared/lib/date` (invariant #14). The
  `@internationalized/date` adapter is app-local and isolated behind
  `BusinessDateAdapter`/`CalendarDay` so the planned migration onto
  `@trata/dates` touches one file; its types (`DateValue`) may
  appear only at the calendar bridge (`TransactionsDateFilter.vue`).
