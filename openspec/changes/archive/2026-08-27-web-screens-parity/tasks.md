# Tasks: web-screens-parity

## 1. Data layer extension

- [x] 1.1 Extend the worker (`shared/lib/local-db/local-db-worker.ts`) to construct and expose debtor, debt-operation, and planned-payment repositories; grow the `LocalDbApi` contract type and `provideRepositories` DI keys accordingly
- [x] 1.2 Create web entity slices `entities/debtor`, `entities/debt-operation`, `entities/planned-payment` (barrels: repository access + types; no logic of their own — semantics come from the package)
- [x] 1.3 Unit tests: RPC surface exposes the three repositories (extend the bridge test from change 1)

## 2. Analytics screens

- [x] 2.1 Create `entities/analytics` slice: port the mobile analytics selectors (period totals, per-category distribution) over colada-cached transactions; date math via `@trata/dates`
- [x] 2.2 Build the donut chart component (SVG, token-driven colors, legend) in `shared/ui` with visual snapshot/unit tests
- [x] 2.3 Build `pages/analytics` (overview: expenses/income cards with donut + legend, empty states) satisfying the analytics capability; RU copy from the mobile screens
- [x] 2.4 Build `pages/analytics-detail` at `/analytics/:direction` (period selector week/month/year, prev/next navigation, inclusive range label, per-category breakdown) satisfying the analytics capability
- [x] 2.5 Unit tests for both screens (mock selectors; period switching; empty states)

## 3. Debts screens

- [x] 3.1 Build `pages/debts` list: two-direction sections («Мне должны» / «Я должен»), summary cards, debtor rows with derived balances
- [x] 3.2 Debtor history dialog: operation history grouped by date, balance header, actions to add/edit operations
- [x] 3.3 Operation form dialog (direction, kind, amount, note, date) and new-debtor-with-first-debt dialog, with validation mirroring the debts capability
- [x] 3.4 Unit tests: list rendering per direction, balance derivation display, form validation, edit/delete flows

## 4. Plans screens

- [x] 4.1 Build `pages/plans`: plans card + list (name, next due, regularity, amount), grouped due/ upcoming, empty states
- [x] 4.2 Plan form dialog (type, amount, name, account, category, regularity, anchor date, confirm mode, reminder, note) per the planned-payments capability
- [x] 4.3 Confirm flow dialog: review the upcoming transaction, confirm generates the transaction and advances `nextDue` (materialization from the package), skip/edit paths per mobile UX
- [x] 4.4 Unit tests: list states, form validation, confirm generates a transaction and advances the plan

## 5. Income entry and dashboard alignment

- [x] 5.1 Build `pages/income` quick income entry (amount, account, income category, description) with validation; reachable from nav and dashboard quick actions
- [x] 5.2 Align dashboard quick actions with the mobile home (expense/transfer/income entries)
- [x] 5.3 Unit tests for the income form and quick-action wiring

## 6. Navigation, i18n keys, routes

- [x] 6.1 Add router entries (`/analytics`, `/analytics/:direction`, `/debts`, `/plans`, `/income`) and extend `AppNav` with the new sections (analytics, debts, plans)
- [x] 6.2 Add vue-i18n keys for all new screens/nav in the existing message files (RU authoritative from mobile copy, EN entries where the structure expects them)
- [x] 6.3 Deep-link and back-button behavior check for all new routes

## 7. Conflict center completion

- [x] 7.1 Restore-as-new flow for deleted-kind conflicts: from a delete-vs-edit conflict, offer restoring the preserved `localState` as a new record with a new id (satisfies the `sync-protocol` SHALL; web-local-first-core shipped the record with `localState` and review/dismiss only)

## 8. e2e, gates, docs

- [x] 8.1 Backendless e2e flows: analytics renders from local data; debts create→history→edit; plan create→confirm→transaction appears; income entry→cashflow update
- [x] 8.2 Full gates: `pnpm -C apps/web type-check test:unit test:e2e`, `pnpm arch:check` (new slices pass FSD rules), `pnpm lint`, `pnpm knip`
- [x] 8.3 Update `apps/web/AGENTS.md` screen map and architecture overview pointers
- [x] 8.4 `openspec validate web-screens-parity --strict` passes
