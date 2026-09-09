# Proposal: web-screens-parity

## Why

Stage 4's product direction is a web app whose UX mirrors the mobile app
with web-native presentation. The local-first core (web-local-first-core)
makes the data layer identical to mobile's, but the web app is missing the
screens mobile already ships: analytics (overview + per-direction detail),
debts, plans (planned payments), and the quick income entry — while its
navigation predates the mobile UX.

## What Changes

- **New web screens** ported from mobile with web-native presentation:
  analytics overview + per-direction detail, debts (list, debtor history,
  operation create/edit, debtor creation), plans (list, plan create/edit,
  confirm flow), and quick income entry.
- **Worker RPC surface grows** to expose debtor, debt-operation, and
  planned-payment repositories from `@trata/local-data` (they
  enter the web with their screens).
- **Navigation alignment**: the app nav exposes the full screen set
  (dashboard, transactions, analytics, debts, plans, accounts, settings);
  existing screens (dashboard, transactions, accounts, settings) get minor
  alignment where mobile UX dictates (quick actions, row editing).
- Web-only conveniences stay (e.g., the transactions page); parity is about
  the shared feature set, not pixel equality.
- New screens are local-first by construction (change 1's repositories);
  sync of the new entity kinds works without further protocol changes.

## Capabilities

### New Capabilities

- `web-screens`: the web app's screen inventory and navigation contract —
  which screens exist, how they are reached, and the parity principle
  (mobile UX semantics, web-native presentation) for the shared feature set.

### Modified Capabilities

(none — domain behavior of analytics, debts, planned payments, and
transactions is already specified platform-neutrally in `analytics`,
`debts`, `planned-payments`, and `transactions`; the mobile-scoped wording
in `analytics` (e.g. "tab") is satisfied by the web navigation entry and is
not a requirement change.)

## Impact

- `apps/web`: new page slices (`pages/analytics`, `pages/analytics-detail`,
  `pages/debts`, `pages/plans`, `pages/income`), entity slices for
  debtor/debt-operation/planned-payment (barrels + local wiring), worker RPC
  surface extension, router/nav entries, i18n keys for the new screens in
  the existing locale files.
- No backend, OpenAPI, or package changes (`@trata/local-data`
  already ships all needed repositories and sync kinds).
- Tests: unit tests per screen (mock repositories, existing patterns),
  e2e backendless flows for the new screens.
