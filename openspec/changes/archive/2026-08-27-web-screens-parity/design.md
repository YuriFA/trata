# Design: web-screens-parity

## Context

Change 1 (web-local-first-core) gives the web app the same local-first data
layer as mobile: worker RPC over `@trata/local-data`. The mobile
app ships screens the web lacks: analytics (`pages/analytics`,
`analytics-detail`), debts (`pages/debts` — list, debtor history sheet,
operation form, debtor+debt creation sheet), plans (`pages/plans` — list
card, list sheet, plan form, confirm sheet), and quick income
(`pages/income`). The web has dashboard/transactions/accounts/settings with
a top `AppNav` and reka-ui + tailwind as the UI base; vue-i18n keys already
back the existing nav (`t('nav.*')`).

Domain behavior for every new screen is already specified and implemented:
`analytics`, `debts`, `planned-payments` specs + the package's repositories
(debtor, debt-operation, planned-payment, with monthly materialization for
plans' `nextDue` on read — client-side recurrence, no backend involvement).

## Goals / Non-Goals

**Goals:**

- Ship the missing screens on the web with mobile UX semantics and
  web-native presentation.
- Extend the worker RPC surface minimally: three more repositories.
- Keep existing web screens; align them only where mobile UX dictates.

**Non-Goals:**

- Pixel parity or mobile navigation idioms (bottom sheets, stack pushes).
- New domain behavior — every screen satisfies existing specs.
- PWA/i18n completeness (change 3); new screens use the existing i18n
  mechanism and get keys in the current locales as part of their build.
- Mobile app changes.

## Decisions

### D1. Presentation mapping: mobile sheets → web dialogs/routes

Mobile bottom sheets (debtor history, operation form, plan form, confirm)
map to reka-ui dialogs; mobile screen pushes (analytics detail, debtor
history full screen on tablets) map to routes. Detail screens are
deep-linkable (`/analytics/:direction`, debtor history inside the debts
screen as a dialog or routed panel — dialog chosen: it is an inspect-and-act
affordance, not a destination). Forms follow the web form conventions
already used by the existing create/edit forms (vee-validate + zod), not a
port of `mobile-forms` idioms.

### D2. Analytics computation on the main thread

Mobile computes analytics from locally cached transactions via selectors
(personal-data scale; no SQL aggregation needed). The web mirrors this:
colada-cached transactions feed the same selector shapes ported into
`entities/analytics` (web slice), donut rendering via a small SVG component
(no chart library — the mobile charts are custom-drawn; keep the dependency
surface at zero). Date math goes through `@trata/dates` (the
sanctioned web exception for `@internationalized/date` continues).

### D3. Worker RPC grows by three repositories

`expose` adds `debtors`, `debtOperations`, `plannedPayments` objects built
from the package's factories. The `Remote` contract type grows accordingly;
`provideRepositories` provides their DI keys to the app. Sync kinds
`debtor`/`debt_operation`/`planned_payment` already exist in the engine —
no sync changes.

### D4. Entity slices and FSD placement

New web entity slices (`entities/debtor`, `entities/debt-operation`,
`entities/planned-payment`, `entities/analytics`) export barrels with
repository access + selectors, mirroring the mobile slices' public surface
minus React specifics. Page slices live under `pages/` per the existing
web FSD; the debts/plans screens decompose into `ui/` components following
the mobile file structure (screen, cards, rows, forms) so review against
the mobile twin is mechanical.

### D5. Dashboard and quick actions alignment

The dashboard keeps its web layout; quick actions align with the mobile
home (expense/transfer/income entries). The quick income entry is a page
(`/income`) reachable from quick actions and the nav, mirroring
`pages/income` semantics (amount, account, income category, description).
The existing transactions page stays as-is beyond row-action alignment
already shipped.

### D6. Locale keys

New screens add keys under the existing vue-i18n message files following
current group conventions; RU copy is authoritative (translated from the
mobile screens' RU strings), EN entries are added where the file structure
already expects them — full EN coverage and default-locale flip remain
change 3's scope.

### D7. Conflict center completion: restore-as-new

web-local-first-core shipped the conflict center with keep/take for
version-kind conflicts and review/dismiss for deleted-kind (delete-vs-edit),
preserving the lost edit's `localState` in the conflict record but deferring
the restore UI. `sync-protocol` requires "an option to restore it as a new
record with a new id" for those conflicts, so this change completes the flow:
restore-as-new reads the preserved `localState`, creates a fresh record
(new client UUID), and resolves the conflict — UI over already-stored data,
no engine changes.

## Risks / Trade-offs

- [Port drift: web screens quietly diverge from mobile semantics] → spec
  deltas pin parity at the requirement level; review checklist per screen
  against the mobile twin's tests.
- [Custom donut SVG vs chart library] → zero new dependencies and full
  token control; at personal-data scale perf is a non-issue.
- [RPC surface sprawl] → the exposed API stays a flat object of repository
  factories + sync controller; no ad-hoc endpoints.
- [Plans' client-side recurrence duplicated?] → no: recurrence/materialize
  helpers come from `@trata/local-data`; web adds no logic.

## Migration Plan

Pure additive web change; no coordination with change 1 beyond landing
after it. Rollback = revert.

## Open Questions

- Debtor history as dialog vs routed panel can be revisited during review
  without changing the spec (both satisfy "web-native navigation").

## Deviations during implementation

- **Plans list shape (task 4.1)**: implemented as mobile parity — one flat
  next-due-ascending list where overdue plans sort first with a badge; the
  mobile twin has no due/upcoming section split, and `planned-payments`
  governs the behavior.
- **Donut tests (task 2.2)**: delivered as structural unit tests over the
  rendered SVG; the repo has no visual-snapshot infrastructure.
- **Swipe-carousel analytics detail** maps to the web-native prev/next
  controls per this change's presentation rule; a category drill-down
  dialog was added as required by the analytics capability the delta binds
  to.
- **Enabling edits beyond `apps/web` pages**: `@trata/dates`
  became a web dependency (mandated by D2); `packages/local-data`
  `balances.ts` parameter types widened to `readonly` (type-level only,
  128 package tests green); `NativeSelect` emit fixed to tuple syntax;
  steiger gained a scoped ignore for `entities/analytics` (its name
  falsely trips the pluralization heuristic); three entity barrels now
  export their `useXRepository` composables (consumed by restore-as-new).
- **Docs**: stale "web is online-first" claims in
  `docs/architecture/overview.md` corrected while updating its pointers.
