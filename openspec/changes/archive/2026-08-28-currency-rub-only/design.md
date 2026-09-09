## Context

Currency today: accounts carry a `USD/EUR/RUB` enum through the OpenAPI
contract, the sync protocol, and both apps; every cross-account aggregate
(analytics totals, debts, plans, the API's `netWorth`) sums minor units
with no conversion. `@trata/money` defaults to `USD`, so a
fresh web install displays dollars for aggregates and defaults new
accounts to USD, while the mobile form hardcodes `RUB`. Currency pickers
exist in the web settings screen and both account-creation forms.
`GET /accounts/balances` returns a cross-currency `netWorth` and has no
consumers. No production data exists.

See `proposal.md` for motivation; see `specs/` for the behavior contract.

## Goals / Non-Goals

**Goals:**

- Rubles as the only currency a user can express or see, in both apps,
  from one shared source (`DEFAULT_CURRENCY`).
- Keep the contract multi-currency-ready: enum, server validation, and
  sync protocol untouched.
- Remove the contract's one knowingly-wrong aggregate
  (`GET /accounts/balances` + `netWorth`).
- Record the multi-currency direction so the future change starts from a
  written decision.

**Non-Goals:**

- Exchange rates, cross-currency transfers, converted aggregates, or a
  display-currency setting (future change, own ADR).
- Narrowing the OpenAPI currency enum or adding server-side RUB-only
  enforcement.
- Data migration of any kind.
- Touching the mobile account-list currency label (stays as-is).

## Decisions

### D1: UI-level constraint, contract stays wide

The `USD/EUR/RUB` enum on accounts is unchanged; only what the apps offer
changes. Alternative considered: narrowing the enum to `[RUB]` server-side.
Rejected because it churns the spec, generated code, and
`AccountSyncData` (older offline clients pushing USD accounts would start
failing sync), and it must be widened back when multi-currency lands. The
UI is the only creation path, so a UI constraint is sufficient.

Consequence: API-level creation of non-RUB accounts remains possible.
The same-currency transfer validation in both apps' UIs stays as the only
guard for that case, and per-account currency labels keep such accounts
legible.

### D2: `DEFAULT_CURRENCY` → `RUB` is the single display-currency source

Consumers that need a currency for currency-less amounts (debts, plans,
analytics totals, dashboard empty state) import `DEFAULT_CURRENCY` from
`@trata/money` instead of reading a settings field. The web
settings store drops `currency` entirely (locale and theme remain); a
stale `currency` key left in localStorage is simply ignored - no cleanup
migration. Alternative considered: keeping the store field pinned to RUB.
Rejected: dead state that must be reworked anyway when multi-currency
introduces a real display-currency concept.

### D3: Forms lose the currency field; mappers hardwire RUB

The account-creation form models and validation schemas drop `currency`;
the submit mapper sends `currency: DEFAULT_CURRENCY`. Alternative
considered: keeping the field with a hidden control. Rejected: dead model
state and dead locale keys for zero benefit. Related locale keys
(`settings.currency`, `addAccount.currencyLabel` and siblings) are
removed; the transfer same-currency message key stays (D1).

### D4: Remove `GET /accounts/balances` spec-first

Order: edit `docs/api/openapi.yaml` (path + `AccountBalancesResponse` +
`AccountBalance` schemas), `make gen` + `pnpm gen:api`, then delete the
backend handler, service method, repository method, sqlc query, and the
`domain.AccountBalance` type. Both apps already compute per-currency
totals client-side from the account listing; nothing consumes the
endpoint (verified in both apps and `packages/`). Alternative considered:
fixing the endpoint to per-currency totals. Rejected: maintaining an
endpoint with no consumers, with a shape multi-currency will supersede.

### D5: Mobile account-list label stays

The per-account currency label in the mobile list remains: with RUB-only
data it reads as a consistent "₽/RUB" affordance, and it keeps
API-created foreign-currency accounts legible (D1). The web account card
has no separate label (the symbol comes from `formatMoney`) and needs no
change.

### D6: Multi-currency direction recorded in `docs/assumptions.md`

Not an ADR: the decisions that would justify one (rate source, rate
storage and precision, transfer two-amount semantics, debts/plans
currency) belong to the future change. The assumptions entry pins the
direction: transfers with two amounts plus a rate snapshot, per-currency
totals converted into a display currency, currency-lessness of
debts/plans flagged as an open question.

## Risks / Trade-offs

- [Non-RUB accounts can still be created via the API directly] → accepted
  (D1); transfer UI validation blocks cross-currency flows, labels keep
  them legible, and no production users exist.
- [Endpoint removal is a breaking contract change] → no production
  clients; offline sync does not use this endpoint (it is not part of the
  sync protocol), so old mobile builds are unaffected.
- [Stale `currency` key in existing localStorage] → ignored by the new
  store; no user-visible effect.
- [Future multi-currency re-adds pickers and a display-currency setting]
  → planned; nothing in this change taxes it (enum, sync data, and
  formatting stay currency-aware).
